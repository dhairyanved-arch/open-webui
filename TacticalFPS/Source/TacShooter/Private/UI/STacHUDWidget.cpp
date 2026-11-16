#include "UI/STacHUDWidget.h"
#include "TacBomb.h"
#include "TacCharacter.h"
#include "TacGameState.h"
#include "TacPlayerController.h"
#include "TacPlayerState.h"
#include "TacWeaponData.h"

#include "Brushes/SlateRoundedBoxBrush.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "GenericPlatform/GenericApplication.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/CoreStyle.h"

namespace
{
	const FLinearColor FriendColor(0.30f, 0.75f, 1.00f);
	const FLinearColor EnemyColor(1.00f, 0.27f, 0.22f);
	const FLinearColor ObjectiveColor(1.00f, 0.80f, 0.20f);
	const FLinearColor PanelColor(0.02f, 0.03f, 0.04f, 0.55f);

	const float MinimapRangeUnits = 3000.f;  // world distance from the centre of the minimap to its rim
	const float EnemyPingSeconds = 2.5f;
	const float KillFeedSeconds = 6.f;
	const int32 KillFeedRows = 5;

	FLinearColor WithAlpha(const FLinearColor& Color, float Alpha)
	{
		return FLinearColor(Color.R, Color.G, Color.B, Color.A * Alpha);
	}

	/** One brush draws a filled circle of any size: a rounded box whose corner radius is half its height. */
	const FSlateBrush* GetDiscBrush()
	{
		static FSlateRoundedBoxBrush* Brush = nullptr;
		if (!Brush)
		{
			Brush = new FSlateRoundedBoxBrush(FLinearColor::White, 4.f);
			Brush->OutlineSettings.RoundingType = ESlateBrushRoundingType::HalfHeightRadius;
		}
		return Brush;
	}

	const TCHAR* ControlLabel(ETacTouchControl Control)
	{
		switch (Control)
		{
		case ETacTouchControl::Fire: return TEXT("FIRE");
		case ETacTouchControl::ADS: return TEXT("ADS");
		case ETacTouchControl::Reload: return TEXT("RLD");
		case ETacTouchControl::Crouch: return TEXT("CRH");
		case ETacTouchControl::Jump: return TEXT("JMP");
		case ETacTouchControl::Grenade: return TEXT("NADE");
		case ETacTouchControl::Swap: return TEXT("SWAP");
		case ETacTouchControl::Use: return TEXT("USE");
		case ETacTouchControl::Buy: return TEXT("BUY");
		default: return TEXT("");
		}
	}

	const TCHAR* GrenadeLabel(ETacGrenadeType Type)
	{
		switch (Type)
		{
		case ETacGrenadeType::Flash: return TEXT("FLASH");
		case ETacGrenadeType::Smoke: return TEXT("SMOKE");
		default: return TEXT("HE");
		}
	}
}

/**
 * Small immediate-mode helper over Slate draw elements. Fills go on the base layer, strokes and
 * markers one above, text on top, so blocks never have to think about draw order.
 */
struct FTacHudPainter
{
	FSlateWindowElementList& Elements;
	const FGeometry& Geometry;
	int32 Layer;

	void Rect(const FVector2D& Position, const FVector2D& Size, const FLinearColor& Color, int32 LayerOffset = 0) const
	{
		FSlateDrawElement::MakeBox(Elements, Layer + LayerOffset, Geometry.ToPaintGeometry(Size, FSlateLayoutTransform(Position)),
			FCoreStyle::Get().GetBrush("WhiteBrush"), ESlateDrawEffect::None, Color);
	}

	void Disc(const FVector2D& Center, float Radius, const FLinearColor& Color, int32 LayerOffset = 0) const
	{
		const FVector2D Size(Radius * 2.f, Radius * 2.f);
		FSlateDrawElement::MakeBox(Elements, Layer + LayerOffset, Geometry.ToPaintGeometry(Size, FSlateLayoutTransform(Center - Size * 0.5f)),
			GetDiscBrush(), ESlateDrawEffect::None, Color);
	}

	void Line(const FVector2D& A, const FVector2D& B, const FLinearColor& Color, float Thickness) const
	{
		TArray<FVector2D> Points;
		Points.Add(A);
		Points.Add(B);
		FSlateDrawElement::MakeLines(Elements, Layer + 1, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Color, true, Thickness);
	}

	void Ring(const FVector2D& Center, float Radius, const FLinearColor& Color, float Thickness) const
	{
		const int32 Segments = 40;
		TArray<FVector2D> Points;
		Points.Reserve(Segments + 1);
		for (int32 Index = 0; Index <= Segments; ++Index)
		{
			const float Angle = 2.f * PI * Index / Segments;
			Points.Add(Center + FVector2D(FMath::Cos(Angle), FMath::Sin(Angle)) * Radius);
		}
		FSlateDrawElement::MakeLines(Elements, Layer + 1, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Color, true, Thickness);
	}

	FVector2D Measure(const FString& String, int32 FontSize) const
	{
		const FSlateFontInfo Font = FCoreStyle::GetDefaultFontStyle("Bold", FMath::Max(FontSize, 6));
		return FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(String, Font);
	}

	/** AlignX / AlignY: 0 = Position is the left / top of the text, 0.5 = centre, 1 = right / bottom. */
	FVector2D Text(const FString& String, const FVector2D& Position, int32 FontSize, const FLinearColor& Color, float AlignX = 0.f, float AlignY = 0.f) const
	{
		const FSlateFontInfo Font = FCoreStyle::GetDefaultFontStyle("Bold", FMath::Max(FontSize, 6));
		const FVector2D Size = FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(String, Font);
		const FVector2D TopLeft(Position.X - Size.X * AlignX, Position.Y - Size.Y * AlignY);
		FSlateDrawElement::MakeText(Elements, Layer + 2, Geometry.ToPaintGeometry(Size, FSlateLayoutTransform(TopLeft)), String, Font,
			ESlateDrawEffect::None, Color);
		return Size;
	}
};

void STacHUDWidget::Construct(const FArguments& InArgs)
{
	OwnerPC = InArgs._OwnerPC;
	SetCanTick(false);
}

FVector2D STacHUDWidget::ComputeDesiredSize(float LayoutScaleMultiplier) const
{
	return FVector2D(1920.f, 1080.f);
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

STacHUDWidget::FLayout STacHUDWidget::ComputeLayout(const FGeometry& Geometry) const
{
	FLayout Layout;
	Layout.Size = Geometry.GetLocalSize();
	Layout.Unit = static_cast<float>(Layout.Size.Y) / 1080.f;

	// Keep information clear of notches, rounded corners and gesture bars.
	FDisplayMetrics Metrics;
	FSlateApplication::Get().GetCachedDisplayMetrics(Metrics);
	const float ToLocal = Geometry.Scale > 0.f ? 1.f / Geometry.Scale : 1.f;
	const float Margin = 24.f * Layout.Unit;

	Layout.Left = static_cast<float>(Metrics.TitleSafePaddingSize.X) * ToLocal + Margin;
	Layout.Top = static_cast<float>(Metrics.TitleSafePaddingSize.Y) * ToLocal + Margin;
	Layout.Right = static_cast<float>(Layout.Size.X) - static_cast<float>(Metrics.TitleSafePaddingSize.Z) * ToLocal - Margin;
	Layout.Bottom = static_cast<float>(Layout.Size.Y) - static_cast<float>(Metrics.TitleSafePaddingSize.W) * ToLocal - Margin;

	// Top left: circular minimap.
	Layout.MinimapRadius = 105.f * Layout.Unit;
	Layout.MinimapCenter = FVector2D(Layout.Left + Layout.MinimapRadius, Layout.Top + Layout.MinimapRadius);
	return Layout;
}

int32 STacHUDWidget::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const ATacPlayerController* PC = OwnerPC.Get();
	const UWorld* World = PC ? PC->GetWorld() : nullptr;
	const ATacGameState* GameState = World ? World->GetGameState<ATacGameState>() : nullptr;
	if (!PC || !GameState)
	{
		return LayerId;
	}

	const FLayout Layout = ComputeLayout(AllottedGeometry);
	const FTacHudPainter Painter{ OutDrawElements, AllottedGeometry, LayerId };
	const ATacCharacter* Character = PC->GetTacCharacter();
	const bool bAlive = Character && Character->IsAlive();

	PaintTouchControls(Painter, Layout, *PC, Character);          // bottom left / bottom right
	PaintMinimap(Painter, Layout, *PC, *GameState);               // top left
	PaintClockAndKillFeed(Painter, Layout, *PC, *GameState);      // top right
	if (bAlive)
	{
		PaintVitals(Painter, Layout, *PC, *Character, *GameState); // bottom left (HP / AP), bottom centre (ammo)
		PaintCrosshair(Painter, Layout, *PC, *Character);
	}
	PaintAnnouncements(Painter, Layout, *PC, *GameState);

	// Flashbang white-out over everything.
	const float FlashAlpha = PC->GetFlashAlpha();
	if (FlashAlpha > 0.f)
	{
		Painter.Rect(FVector2D::ZeroVector, Layout.Size, FLinearColor(1.f, 1.f, 1.f, FlashAlpha), 4);
	}

	return LayerId + 5;
}

// ---------------------------------------------------------------------------------------------
// Touch controls (drawn only; input is handled by ATacPlayerController)
// ---------------------------------------------------------------------------------------------

void STacHUDWidget::PaintTouchControls(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacCharacter* Character) const
{
	const bool bEditing = PC.IsLayoutEditMode();
	if (!bEditing && (!Character || !Character->IsAlive()))
	{
		return;
	}

	const FTacTouchLayout& Touch = PC.GetTouchLayout();
	const float Alpha = Touch.Opacity;
	const float Unit = Layout.Unit;
	const float Height = static_cast<float>(Layout.Size.Y);

	// Movement stick.
	FVector2D BaseNormalized;
	FVector2D ThumbNormalized;
	PC.GetJoystickVisual(BaseNormalized, ThumbNormalized);
	const FVector2D Base = BaseNormalized * Layout.Size;
	const float StickRadius = Touch.JoystickRadius * Height;
	Painter.Disc(Base, StickRadius, FLinearColor(1.f, 1.f, 1.f, 0.06f * Alpha));
	Painter.Ring(Base, StickRadius, FLinearColor(1.f, 1.f, 1.f, 0.40f * Alpha), 2.f * Unit);
	// The inner ring marks where a walk becomes a run.
	Painter.Ring(Base, StickRadius * (Touch.JoystickDeadZone + Touch.WalkThreshold * (1.f - Touch.JoystickDeadZone)),
		FLinearColor(1.f, 1.f, 1.f, 0.15f * Alpha), 1.f * Unit);
	Painter.Disc(ThumbNormalized * Layout.Size, StickRadius * 0.38f, FLinearColor(1.f, 1.f, 1.f, 0.45f * Alpha), 1);

	// Action buttons.
	for (int32 Index = 0; Index < Touch.Buttons.Num(); ++Index)
	{
		const ETacTouchControl Control = static_cast<ETacTouchControl>(Index);
		if (!PC.IsControlVisible(Control))
		{
			continue;
		}
		const FTacTouchButton& Button = Touch.Buttons[Index];
		const FVector2D Center = Button.Center * Layout.Size;
		const float Radius = Button.Radius * Height;

		const bool bActive = PC.IsControlPressed(Control)
			|| (Control == ETacTouchControl::ADS && Character && Character->IsADS())
			|| (Control == ETacTouchControl::Crouch && Character && Character->bIsCrouched);
		const bool bContextual = Control == ETacTouchControl::Use || Control == ETacTouchControl::Buy;
		const FLinearColor Tint = bContextual ? ObjectiveColor : FLinearColor::White;

		Painter.Disc(Center, Radius, WithAlpha(Tint, (bActive ? 0.40f : 0.10f) * Alpha));
		Painter.Ring(Center, Radius, WithAlpha(Tint, 0.55f * Alpha), 2.f * Unit);

		FString Label = ControlLabel(Control);
		if (Control == ETacTouchControl::Use && Character)
		{
			Label = Character->GetTeam() == ETacTeam::Attackers ? TEXT("PLANT") : TEXT("DEFUSE");
		}
		Painter.Text(Label, Center, FMath::RoundToInt(Radius * 0.30f), WithAlpha(Tint, 0.9f * Alpha), 0.5f, 0.5f);
	}

	// Grenade quick-select: hold the grenade button and slide onto an option.
	if (PC.IsGrenadeWheelOpen() && Character && Touch.Buttons.IsValidIndex(static_cast<int32>(ETacTouchControl::Grenade)))
	{
		const FVector2D Center = Touch.Buttons[static_cast<int32>(ETacTouchControl::Grenade)].Center * Layout.Size;
		const float Reach = 0.17f * Height;
		const float OptionRadius = 0.055f * Height;
		for (int32 Option = 0; Option < 3; ++Option)
		{
			const ETacGrenadeType Type = static_cast<ETacGrenadeType>(Option);
			const int32 Count = Character->GetInventory().GetGrenadeCount(Type);
			const bool bSelected = PC.GetGrenadeWheelSelection() == Option;
			const FVector2D OptionCenter = Center + ATacPlayerController::GetGrenadeWheelDirection(Option) * Reach;
			const float OptionAlpha = Count > 0 ? 1.f : 0.35f;

			Painter.Disc(OptionCenter, OptionRadius, bSelected ? WithAlpha(ObjectiveColor, 0.55f * OptionAlpha) : FLinearColor(0.f, 0.f, 0.f, 0.5f * OptionAlpha));
			Painter.Ring(OptionCenter, OptionRadius, FLinearColor(1.f, 1.f, 1.f, 0.7f * OptionAlpha), 2.f * Unit);
			Painter.Text(GrenadeLabel(Type), OptionCenter, FMath::RoundToInt(13.f * Unit), FLinearColor(1.f, 1.f, 1.f, OptionAlpha), 0.5f, 1.f);
			Painter.Text(FString::Printf(TEXT("x%d"), Count), OptionCenter, FMath::RoundToInt(13.f * Unit), FLinearColor(1.f, 1.f, 1.f, OptionAlpha), 0.5f, 0.f);
		}
	}

	if (bEditing)
	{
		Painter.Text(TEXT("EDITING CONTROLS  -  drag to move"), FVector2D(Layout.Size.X * 0.5f, Layout.Top), FMath::RoundToInt(20.f * Unit),
			ObjectiveColor, 0.5f, 0.f);
	}
}

// ---------------------------------------------------------------------------------------------
// Top left: circular minimap
// ---------------------------------------------------------------------------------------------

void STacHUDWidget::PaintMinimap(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacGameState& GameState) const
{
	const UWorld* World = PC.GetWorld();
	const FVector2D Center = Layout.MinimapCenter;
	const float Radius = Layout.MinimapRadius;
	const float Unit = Layout.Unit;
	const float Now = World->GetTimeSeconds();
	const ETacTeam MyTeam = PC.GetTeam();

	Painter.Disc(Center, Radius, PanelColor);
	Painter.Ring(Center, Radius, FLinearColor(1.f, 1.f, 1.f, 0.35f), 2.f * Unit);
	Painter.Ring(Center, Radius * 0.5f, FLinearColor(1.f, 1.f, 1.f, 0.08f), 1.f * Unit);

	// The map turns with the player: whatever is ahead is at the top.
	FVector ViewLocation;
	FRotator ViewRotation;
	PC.GetPlayerViewPoint(ViewLocation, ViewRotation);
	const float YawRadians = FMath::DegreesToRadians(static_cast<float>(ViewRotation.Yaw));
	const FVector2D Forward(FMath::Cos(YawRadians), FMath::Sin(YawRadians));
	const FVector2D Right(-Forward.Y, Forward.X);
	const float Scale = Radius / MinimapRangeUnits;
	const float Rim = Radius - 7.f * Unit;

	auto ToMap = [&](const FVector& WorldLocation, bool bClampToRim, FVector2D& OutPosition)
	{
		const FVector2D Relative(WorldLocation.X - ViewLocation.X, WorldLocation.Y - ViewLocation.Y);
		FVector2D Offset(FVector2D::DotProduct(Relative, Right) * Scale, -FVector2D::DotProduct(Relative, Forward) * Scale);
		const float Length = Offset.Size();
		if (Length > Rim)
		{
			if (!bClampToRim)
			{
				return false;
			}
			Offset *= Rim / Length;
		}
		OutPosition = Center + Offset;
		return true;
	};

	FVector2D Position;

	// Objectives: bomb sites stay pinned to the rim when out of range, so they always give a heading.
	for (TActorIterator<ATacBombSite> It(World); It; ++It)
	{
		if (ToMap(It->GetActorLocation(), true, Position))
		{
			Painter.Disc(Position, 9.f * Unit, WithAlpha(ObjectiveColor, 0.25f), 1);
			Painter.Text(It->SiteName.ToString(), Position, FMath::RoundToInt(12.f * Unit), ObjectiveColor, 0.5f, 0.5f);
		}
	}

	// The bomb: always shown once planted; while carried or dropped only the attackers see it.
	const ATacBomb* Bomb = GameState.Bomb;
	if (IsValid(Bomb))
	{
		const bool bPlanted = Bomb->State == ETacBombState::Planted;
		const bool bLoose = Bomb->State == ETacBombState::Dropped || Bomb->State == ETacBombState::Carried;
		if (bPlanted || (bLoose && MyTeam == ETacTeam::Attackers))
		{
			const FVector BombLocation = (Bomb->State == ETacBombState::Carried && Bomb->Carrier) ? Bomb->Carrier->GetActorLocation() : Bomb->GetActorLocation();
			if (ToMap(BombLocation, true, Position))
			{
				const float Pulse = bPlanted ? 0.6f + 0.4f * FMath::Sin(Now * 8.f) : 1.f;
				Painter.Ring(Position, 7.f * Unit, WithAlpha(EnemyColor, Pulse), 2.f * Unit);
				Painter.Disc(Position, 3.5f * Unit, WithAlpha(ObjectiveColor, Pulse), 1);
			}
		}
	}

	// Players.
	const AActor* ViewTarget = PC.GetViewTarget();
	for (TActorIterator<ATacCharacter> It(World); It; ++It)
	{
		const ATacCharacter* Other = *It;
		if (Other == ViewTarget || !Other->IsAlive())
		{
			continue;
		}

		if (Other->GetTeam() == MyTeam)
		{
			// Teammates: always visible, with a tick showing where they face.
			if (ToMap(Other->GetActorLocation(), true, Position))
			{
				const float OtherYaw = FMath::DegreesToRadians(static_cast<float>(Other->GetActorRotation().Yaw));
				const FVector2D Facing(FMath::Cos(OtherYaw), FMath::Sin(OtherYaw));
				const FVector2D Tick(FVector2D::DotProduct(Facing, Right), -FVector2D::DotProduct(Facing, Forward));
				Painter.Disc(Position, 5.f * Unit, FriendColor, 1);
				Painter.Line(Position, Position + Tick * 11.f * Unit, FriendColor, 2.f * Unit);
			}
		}
		else
		{
			// Enemies: a fading ping where they were last heard (gunfire or running footsteps).
			const float Age = Now - Other->LastRevealTime;
			if (Age >= 0.f && Age < EnemyPingSeconds && ToMap(Other->LastRevealLocation, false, Position))
			{
				const float Fade = 1.f - Age / EnemyPingSeconds;
				Painter.Disc(Position, 5.f * Unit, WithAlpha(EnemyColor, Fade), 1);
				Painter.Ring(Position, (5.f + 10.f * (1.f - Fade)) * Unit, WithAlpha(EnemyColor, Fade * 0.6f), 1.5f * Unit);
			}
		}
	}

	// The player: an arrow in the centre, always pointing up.
	const FVector2D Tip = Center + FVector2D(0.f, -9.f * Unit);
	const FVector2D BackLeft = Center + FVector2D(-6.f * Unit, 7.f * Unit);
	const FVector2D BackRight = Center + FVector2D(6.f * Unit, 7.f * Unit);
	Painter.Line(Tip, BackLeft, FLinearColor::White, 2.f * Unit);
	Painter.Line(BackLeft, BackRight, FLinearColor::White, 2.f * Unit);
	Painter.Line(BackRight, Tip, FLinearColor::White, 2.f * Unit);

	// Money sits under the minimap.
	if (GameState.MatchType == ETacMatchType::BombDefusal)
	{
		if (const ATacPlayerState* PlayerState = PC.GetPlayerState<ATacPlayerState>())
		{
			Painter.Text(FString::Printf(TEXT("$ %d"), PlayerState->Money), FVector2D(Layout.Left, Center.Y + Radius + 10.f * Unit),
				FMath::RoundToInt(20.f * Unit), FLinearColor(0.45f, 0.9f, 0.45f));
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Top right: round timer, score, kill feed
// ---------------------------------------------------------------------------------------------

void STacHUDWidget::PaintClockAndKillFeed(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacGameState& GameState) const
{
	const float Unit = Layout.Unit;
	const float X = Layout.Right;
	const float Now = PC.GetWorld()->GetTimeSeconds();
	const ETacTeam MyTeam = PC.GetTeam();

	// Timer.
	FString Clock = TEXT("--:--");
	FLinearColor ClockColor = FLinearColor::White;
	if (GameState.HasPhaseClock())
	{
		const int32 Seconds = FMath::CeilToInt(GameState.GetPhaseTimeRemaining());
		Clock = FString::Printf(TEXT("%d:%02d"), Seconds / 60, Seconds % 60);
		if (GameState.Phase == ETacRoundPhase::BombPlanted || (GameState.Phase == ETacRoundPhase::Live && Seconds <= 10))
		{
			ClockColor = EnemyColor;
		}
	}
	const FVector2D ClockSize = Painter.Text(Clock, FVector2D(X, Layout.Top), FMath::RoundToInt(34.f * Unit), ClockColor, 1.f, 0.f);

	// Score, own team first.
	const ETacTeam OtherTeam = MyTeam == ETacTeam::Defenders ? ETacTeam::Attackers : ETacTeam::Defenders;
	const ETacTeam ShownTeam = MyTeam == ETacTeam::Defenders ? ETacTeam::Defenders : ETacTeam::Attackers;
	const float ScoreX = X - static_cast<float>(ClockSize.X) - 28.f * Unit;
	const FVector2D EnemyScoreSize = Painter.Text(FString::FromInt(GameState.GetScore(OtherTeam)), FVector2D(ScoreX, Layout.Top + 6.f * Unit),
		FMath::RoundToInt(24.f * Unit), EnemyColor, 1.f, 0.f);
	const FVector2D DividerSize = Painter.Text(TEXT(" : "), FVector2D(ScoreX - EnemyScoreSize.X, Layout.Top + 6.f * Unit),
		FMath::RoundToInt(24.f * Unit), FLinearColor(1.f, 1.f, 1.f, 0.6f), 1.f, 0.f);
	Painter.Text(FString::FromInt(GameState.GetScore(ShownTeam)), FVector2D(ScoreX - EnemyScoreSize.X - DividerSize.X, Layout.Top + 6.f * Unit),
		FMath::RoundToInt(24.f * Unit), FriendColor, 1.f, 0.f);

	// What the clock is counting.
	const TCHAR* PhaseLabel = TEXT("");
	switch (GameState.Phase)
	{
	case ETacRoundPhase::WaitingForPlayers: PhaseLabel = TEXT("WARMUP"); break;
	case ETacRoundPhase::BuyPhase: PhaseLabel = TEXT("BUY PHASE"); break;
	case ETacRoundPhase::BombPlanted: PhaseLabel = TEXT("BOMB PLANTED"); break;
	case ETacRoundPhase::RoundEnd: PhaseLabel = TEXT("ROUND OVER"); break;
	case ETacRoundPhase::MatchEnd: PhaseLabel = TEXT("MATCH OVER"); break;
	default:
		PhaseLabel = GameState.MatchType == ETacMatchType::TeamDeathmatch ? TEXT("DEATHMATCH") : TEXT("");
		break;
	}
	Painter.Text(PhaseLabel, FVector2D(X, Layout.Top + 44.f * Unit), FMath::RoundToInt(13.f * Unit), FLinearColor(1.f, 1.f, 1.f, 0.65f), 1.f, 0.f);

	// Kill feed: newest on top, each line fades out.
	const UTacWeaponCatalog* Catalog = UTacWeaponCatalog::Get(&PC);
	const float RowHeight = 28.f * Unit;
	float Y = Layout.Top + 72.f * Unit;
	int32 Rows = 0;
	for (int32 Index = GameState.KillFeed.Num() - 1; Index >= 0 && Rows < KillFeedRows; --Index)
	{
		const FTacKillFeedEntry& Entry = GameState.KillFeed[Index];
		const float Age = Now - Entry.LocalTime;
		if (Age > KillFeedSeconds)
		{
			break;
		}
		const float Fade = FMath::Clamp(KillFeedSeconds - Age, 0.f, 1.f);

		const UTacWeaponData* Weapon = Catalog ? Catalog->FindWeapon(Entry.WeaponId) : nullptr;
		const FString WeaponName = Weapon ? Weapon->DisplayName.ToString() : Entry.WeaponId.ToString().ToUpper();
		const FString Line = Entry.Killer.IsEmpty()
			? FString::Printf(TEXT("%s  [%s]"), *Entry.Victim, *WeaponName)
			: FString::Printf(TEXT("%s  [%s%s]  %s"), *Entry.Killer, *WeaponName, Entry.bHeadshot ? TEXT(" HS") : TEXT(""), *Entry.Victim);

		// Blue when it is good news for my team, red when it is bad.
		const bool bGoodNews = Entry.VictimTeam != MyTeam;
		const int32 FontSize = FMath::RoundToInt(14.f * Unit);
		const FVector2D LineSize = Painter.Measure(Line, FontSize);
		Painter.Rect(FVector2D(X - LineSize.X - 16.f * Unit, Y), FVector2D(LineSize.X + 16.f * Unit, RowHeight - 4.f * Unit), WithAlpha(PanelColor, Fade));
		Painter.Text(Line, FVector2D(X - 8.f * Unit, Y + (RowHeight - 4.f * Unit) * 0.5f), FontSize, WithAlpha(bGoodNews ? FriendColor : EnemyColor, Fade), 1.f, 0.5f);

		Y += RowHeight;
		++Rows;
	}
}

// ---------------------------------------------------------------------------------------------
// Bottom left: health and armor. Bottom centre: ammo.
// ---------------------------------------------------------------------------------------------

void STacHUDWidget::PaintVitals(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacCharacter& Character, const ATacGameState& GameState) const
{
	const float Unit = Layout.Unit;
	const float BaseY = Layout.Bottom;

	auto Gauge = [&](float X, const TCHAR* Label, int32 Value, const FLinearColor& Color)
	{
		const float BarWidth = 130.f * Unit;
		Painter.Text(Label, FVector2D(X, BaseY - 14.f * Unit), FMath::RoundToInt(13.f * Unit), FLinearColor(1.f, 1.f, 1.f, 0.65f), 0.f, 1.f);
		Painter.Text(FString::FromInt(Value), FVector2D(X + 34.f * Unit, BaseY - 8.f * Unit), FMath::RoundToInt(32.f * Unit), Color, 0.f, 1.f);
		Painter.Rect(FVector2D(X, BaseY - 5.f * Unit), FVector2D(BarWidth, 5.f * Unit), FLinearColor(0.f, 0.f, 0.f, 0.5f));
		Painter.Rect(FVector2D(X, BaseY - 5.f * Unit), FVector2D(BarWidth * FMath::Clamp(Value / 100.f, 0.f, 1.f), 5.f * Unit), Color, 1);
	};

	const int32 Health = FMath::CeilToInt(Character.GetHealth());
	Gauge(Layout.Left, TEXT("HP"), Health, Health <= 25 ? EnemyColor : FLinearColor::White);
	Gauge(Layout.Left + 170.f * Unit, Character.GetInventory().bHelmet ? TEXT("AP+") : TEXT("AP"), Character.GetArmor(), FriendColor);

	// Ammo.
	const FVector2D AmmoAnchor(Layout.Size.X * 0.5f, BaseY);
	const UTacWeaponData* Weapon = Character.GetActiveWeapon();
	FString AmmoText;
	FString NameText;
	if (Character.GetActiveSlot() == ETacWeaponSlot::Grenade)
	{
		AmmoText = FString::Printf(TEXT("x%d"), Character.GetMagAmmo());
		NameText = GrenadeLabel(Character.GetSelectedGrenade());
	}
	else if (Weapon)
	{
		AmmoText = Character.IsReloading() ? FString(TEXT("RELOADING")) : FString::Printf(TEXT("%d / %d"), Character.GetMagAmmo(), Character.GetReserveAmmo());
		NameText = Weapon->DisplayName.ToString().ToUpper();
	}
	const bool bLowAmmo = Weapon && Character.GetMagAmmo() <= Weapon->MagazineSize / 4;
	Painter.Text(AmmoText, AmmoAnchor - FVector2D(0.f, 20.f * Unit), FMath::RoundToInt(30.f * Unit), bLowAmmo ? EnemyColor : FLinearColor::White, 0.5f, 1.f);
	Painter.Text(NameText, AmmoAnchor, FMath::RoundToInt(13.f * Unit), FLinearColor(1.f, 1.f, 1.f, 0.65f), 0.5f, 1.f);

	// What else is being carried.
	const FTacLoadout& Inventory = Character.GetInventory();
	FString Carried = FString::Printf(TEXT("F%d  S%d  H%d"), Inventory.FlashCount, Inventory.SmokeCount, Inventory.HECount);
	if (Inventory.bDefuseKit)
	{
		Carried += TEXT("  KIT");
	}
	const ATacBomb* Bomb = GameState.Bomb;
	const bool bHasBomb = IsValid(Bomb) && Bomb->State == ETacBombState::Carried && Bomb->Carrier.Get() == &Character;
	Painter.Text(Carried, AmmoAnchor + FVector2D(120.f * Unit, 0.f), FMath::RoundToInt(13.f * Unit), FLinearColor(1.f, 1.f, 1.f, 0.65f), 0.f, 1.f);
	if (bHasBomb)
	{
		Painter.Text(TEXT("BOMB"), AmmoAnchor - FVector2D(120.f * Unit, 0.f), FMath::RoundToInt(16.f * Unit), ObjectiveColor, 1.f, 1.f);
	}

	// Plant / defuse progress.
	const float Progress = Character.GetUseProgress();
	if (Progress > 0.f)
	{
		const FVector2D BarSize(320.f * Unit, 10.f * Unit);
		const FVector2D BarPosition(Layout.Size.X * 0.5f - BarSize.X * 0.5f, Layout.Size.Y * 0.62f);
		Painter.Rect(BarPosition, BarSize, FLinearColor(0.f, 0.f, 0.f, 0.6f));
		Painter.Rect(BarPosition, FVector2D(BarSize.X * Progress, BarSize.Y), ObjectiveColor, 1);
		Painter.Text(Character.GetTeam() == ETacTeam::Attackers ? TEXT("PLANTING") : TEXT("DEFUSING"),
			FVector2D(Layout.Size.X * 0.5f, BarPosition.Y - 6.f * Unit), FMath::RoundToInt(15.f * Unit), ObjectiveColor, 0.5f, 1.f);
	}
}

// ---------------------------------------------------------------------------------------------
// Centre: crosshair and hit marker
// ---------------------------------------------------------------------------------------------

void STacHUDWidget::PaintCrosshair(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacCharacter& Character) const
{
	const float Unit = Layout.Unit;
	const FVector2D Center = Layout.Size * 0.5f;

	if (Character.GetActiveWeapon())
	{
		// The gap is the real bullet cone projected onto the screen, so it honestly shows
		// how much accuracy standing still, crouching or aiming buys.
		const float HalfFovRadians = FMath::DegreesToRadians(FMath::Max(Character.Camera->FieldOfView, 1.f) * 0.5f);
		const float SpreadRadians = FMath::DegreesToRadians(Character.GetCurrentSpreadDegrees());
		const float Gap = 4.f * Unit + FMath::Tan(SpreadRadians) / FMath::Tan(HalfFovRadians) * static_cast<float>(Layout.Size.X) * 0.5f;
		const float Length = 9.f * Unit;
		const FLinearColor Color(0.2f, 1.f, 0.3f, 0.9f);
		const float Thickness = 2.f * Unit;

		Painter.Line(Center + FVector2D(Gap, 0.f), Center + FVector2D(Gap + Length, 0.f), Color, Thickness);
		Painter.Line(Center - FVector2D(Gap, 0.f), Center - FVector2D(Gap + Length, 0.f), Color, Thickness);
		Painter.Line(Center + FVector2D(0.f, Gap), Center + FVector2D(0.f, Gap + Length), Color, Thickness);
		Painter.Line(Center - FVector2D(0.f, Gap), Center - FVector2D(0.f, Gap + Length), Color, Thickness);
		Painter.Disc(Center, 1.5f * Unit, Color, 1);
	}

	// Hit marker: confirmed by the server, red for a headshot or a kill.
	const float HitAge = PC.GetHitMarkerAge();
	if (HitAge >= 0.f && HitAge < 0.2f)
	{
		const FLinearColor Color = WithAlpha(PC.WasLastHitHeadshot() ? EnemyColor : FLinearColor::White, 1.f - HitAge / 0.2f);
		const float Inner = 7.f * Unit;
		const float Outer = 15.f * Unit;
		for (int32 Corner = 0; Corner < 4; ++Corner)
		{
			const FVector2D Direction((Corner & 1) ? 1.f : -1.f, (Corner & 2) ? 1.f : -1.f);
			Painter.Line(Center + Direction * Inner, Center + Direction * Outer, Color, 2.f * Unit);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Centre top: round announcements
// ---------------------------------------------------------------------------------------------

void STacHUDWidget::PaintAnnouncements(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacGameState& GameState) const
{
	const float Unit = Layout.Unit;
	const float Now = PC.GetWorld()->GetTimeSeconds();
	const float SincePhaseChange = Now - GameState.LastPhaseChangeLocalTime;
	const ETacTeam MyTeam = PC.GetTeam();
	const FVector2D Anchor(Layout.Size.X * 0.5f, Layout.Size.Y * 0.2f);

	FString Headline;
	FString Detail;
	FLinearColor Color = FLinearColor::White;
	bool bSticky = false; // stays up for the whole phase rather than a few seconds

	switch (GameState.Phase)
	{
	case ETacRoundPhase::WaitingForPlayers:
		Headline = TEXT("WAITING FOR PLAYERS");
		bSticky = true;
		break;

	case ETacRoundPhase::BuyPhase:
		Headline = FString::Printf(TEXT("ROUND %d"), GameState.RoundNumber);
		Detail = MyTeam == ETacTeam::Attackers ? TEXT("Plant the bomb or eliminate the defenders") : TEXT("Stop the bomb or eliminate the attackers");
		break;

	case ETacRoundPhase::BombPlanted:
		Headline = TEXT("BOMB PLANTED");
		Color = EnemyColor;
		break;

	case ETacRoundPhase::RoundEnd:
	{
		const bool bWon = GameState.LastRoundWinner == MyTeam;
		Headline = bWon ? TEXT("ROUND WON") : TEXT("ROUND LOST");
		Color = bWon ? FriendColor : EnemyColor;
		switch (GameState.LastRoundEndReason)
		{
		case ETacRoundEndReason::Elimination: Detail = TEXT("Team eliminated"); break;
		case ETacRoundEndReason::TimeExpired: Detail = TEXT("Time ran out"); break;
		case ETacRoundEndReason::BombDetonated: Detail = TEXT("The bomb detonated"); break;
		case ETacRoundEndReason::BombDefused: Detail = TEXT("The bomb was defused"); break;
		default: break;
		}
		bSticky = true;
		break;
	}

	case ETacRoundPhase::MatchEnd:
		if (GameState.LastRoundWinner == ETacTeam::None)
		{
			Headline = TEXT("DRAW");
		}
		else
		{
			const bool bWon = GameState.LastRoundWinner == MyTeam;
			Headline = bWon ? TEXT("VICTORY") : TEXT("DEFEAT");
			Color = bWon ? FriendColor : EnemyColor;
		}
		Detail = FString::Printf(TEXT("%d  :  %d"), GameState.AttackerScore, GameState.DefenderScore);
		bSticky = true;
		break;

	default:
		break;
	}

	if (!Headline.IsEmpty() && (bSticky || SincePhaseChange < 4.f))
	{
		const float Fade = bSticky ? 1.f : FMath::Clamp(4.f - SincePhaseChange, 0.f, 1.f);
		Painter.Text(Headline, Anchor, FMath::RoundToInt(38.f * Unit), WithAlpha(Color, Fade), 0.5f, 1.f);
		if (!Detail.IsEmpty())
		{
			Painter.Text(Detail, Anchor + FVector2D(0.f, 6.f * Unit), FMath::RoundToInt(16.f * Unit), FLinearColor(1.f, 1.f, 1.f, 0.8f * Fade), 0.5f, 0.f);
		}
	}

	if (PC.IsSpectating())
	{
		Painter.Text(TEXT("SPECTATING"), FVector2D(Layout.Size.X * 0.5f, Layout.Bottom), FMath::RoundToInt(18.f * Unit),
			FLinearColor(1.f, 1.f, 1.f, 0.8f), 0.5f, 1.f);
	}
}
