#include "TacPlayerController.h"
#include "TacCharacter.h"
#include "TacGameMode.h"
#include "TacGameState.h"
#include "TacPlayerState.h"
#include "TacWeaponData.h"

#include "Camera/CameraComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/GameUserSettings.h"
#include "GameFramework/InputSettings.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	const TCHAR* LayoutSaveSlot = TEXT("TacTouchLayout");

	/** Degrees of turn for a swipe as long as the screen is tall, at sensitivity 1. */
	const float DegreesPerScreenHeight = 120.f;

	// Swipe speeds (degrees per second) between which look acceleration ramps in.
	const float AccelerationStartSpeed = 90.f;
	const float AccelerationFullSpeed = 480.f;

	const float AimAssistRange = 4500.f;
	const float AimAssistTargetRadius = 45.f;
	const float AimAssistMaxSlowdown = 0.45f;
	const float AimAssistMaxSlowdownADS = 0.55f;

	const float DeathmatchBuyWindowSeconds = 10.f; // mirrors ATacGameMode::DeathmatchBuyWindow for the local button
}

ATacPlayerController::ATacPlayerController()
{
	Layout.SetDefaults();
}

void ATacPlayerController::BeginPlay()
{
	Super::BeginPlay();
	if (!IsLocalController())
	{
		return;
	}

	LoadLayout();
	ActivateTouchInterface(nullptr); // no engine virtual joystick; this class owns touch
	SetInputMode(FInputModeGameOnly());

	if (UGameUserSettings* Settings = GEngine ? GEngine->GetGameUserSettings() : nullptr)
	{
		Settings->SetFrameRateLimit(60.f);
		Settings->ApplyNonResolutionSettings();
	}
}

void ATacPlayerController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);
	bSpectating = false;
	ClientSetSpectating(false);
}

ATacCharacter* ATacPlayerController::GetTacCharacter() const
{
	return Cast<ATacCharacter>(GetPawn());
}

ETacTeam ATacPlayerController::GetTeam() const
{
	const ATacPlayerState* TacPlayerState = GetPlayerState<ATacPlayerState>();
	return TacPlayerState ? TacPlayerState->Team : ETacTeam::None;
}

FVector2D ATacPlayerController::GetViewportSizeF() const
{
	int32 SizeX = 0;
	int32 SizeY = 0;
	GetViewportSize(SizeX, SizeY);
	return FVector2D(SizeX, SizeY);
}

// ---------------------------------------------------------------------------------------------
// Per-frame
// ---------------------------------------------------------------------------------------------

void ATacPlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);
	if (!IsLocalController())
	{
		return;
	}

	if (bBuyMenuOpen && !IsBuyAllowedLocally())
	{
		SetBuyMenuOpen(false);
	}

	const ATacCharacter* TacCharacter = GetTacCharacter();
	if (!TacCharacter || !TacCharacter->IsAlive())
	{
		if (!bLayoutEditMode && (PressedMask != 0 || MoveFinger != INDEX_NONE))
		{
			ReleaseAllTouches();
		}
		PendingLookPixels = FVector2D::ZeroVector;
		return;
	}

	UpdateAimAssist(DeltaTime);
	ConsumeTouchLook(DeltaTime);

	FVector2D Move(JoystickValue.X, -JoystickValue.Y); // screen y is down; forward is up
	bool bForceWalk = false;
	TickDesktopFallback(DeltaTime, Move, bForceWalk);
	ApplyMovement(Move, bForceWalk);
}

void ATacPlayerController::ApplyMovement(const FVector2D& MoveInput, bool bForceWalk)
{
	ATacCharacter* TacCharacter = GetTacCharacter();
	const float Magnitude = MoveInput.Size();
	if (!TacCharacter || Magnitude < KINDA_SMALL_NUMBER)
	{
		return;
	}

	// The stick picks the gait rather than an analog speed: a light push is a silent walk,
	// a full push is a run. Speeds stay at the two tuned values, so sound cues are reliable.
	TacCharacter->SetWalking(bForceWalk || Magnitude < Layout.WalkThreshold);

	const FVector2D Direction = MoveInput / Magnitude;
	const FRotationMatrix YawMatrix(FRotator(0.f, GetControlRotation().Yaw, 0.f));
	TacCharacter->AddMovementInput(YawMatrix.GetUnitAxis(EAxis::X), Direction.Y);
	TacCharacter->AddMovementInput(YawMatrix.GetUnitAxis(EAxis::Y), Direction.X);
}

void ATacPlayerController::ApplyLook(float YawDegrees, float PitchDegrees)
{
	FRotator Rotation = GetControlRotation();
	Rotation.Yaw += YawDegrees;
	Rotation.Pitch = FMath::Clamp<double>(FRotator::NormalizeAxis(Rotation.Pitch) + PitchDegrees, -88.0, 88.0);
	Rotation.Roll = 0.f;
	SetControlRotation(Rotation);
}

void ATacPlayerController::ConsumeTouchLook(float DeltaTime)
{
	if (PendingLookPixels.IsNearlyZero() || DeltaTime <= 0.f)
	{
		PendingLookPixels = FVector2D::ZeroVector;
		return;
	}

	const FVector2D ViewportSize = GetViewportSizeF();
	const ATacCharacter* TacCharacter = GetTacCharacter();
	if (ViewportSize.Y < 1.f || !TacCharacter)
	{
		PendingLookPixels = FVector2D::ZeroVector;
		return;
	}

	// Pixels -> degrees, relative to screen height so every device turns the same for the same thumb travel.
	FVector2D Degrees = PendingLookPixels * (DegreesPerScreenHeight * Layout.LookSensitivity / ViewportSize.Y);
	Degrees.Y *= Layout.VerticalSensitivityScale;
	PendingLookPixels = FVector2D::ZeroVector;

	// Fast flicks turn further; slow tracking is left 1:1.
	const float Speed = static_cast<float>(Degrees.Size()) / DeltaTime;
	const float AccelAlpha = FMath::Clamp((Speed - AccelerationStartSpeed) / (AccelerationFullSpeed - AccelerationStartSpeed), 0.f, 1.f);
	Degrees *= 1.f + Layout.LookAcceleration * AccelAlpha;

	// Zoomed in, the same swipe should cover the same distance on screen.
	if (TacCharacter->IsADS())
	{
		Degrees *= Layout.ADSSensitivityScale * (TacCharacter->Camera->FieldOfView / TacCharacter->DefaultFieldOfView);
	}

	// Aim assist: friction only. It scales the player's own input and adds none of its own.
	Degrees *= AimFriction;

	ApplyLook(Degrees.X, -Degrees.Y);
}

void ATacPlayerController::UpdateAimAssist(float DeltaTime)
{
	float TargetFriction = 1.f;

	const ATacCharacter* Me = GetTacCharacter();
	if (Layout.AimAssistStrength > 0.f && Me && Me->IsAlive())
	{
		FVector ViewLocation;
		FRotator ViewRotation;
		GetPlayerViewPoint(ViewLocation, ViewRotation);
		const FVector ViewDirection = ViewRotation.Vector();

		// How strongly is the reticle "on" each enemy? 1 inside the body, fading to 0 a little way outside it.
		float BestStrength = 0.f;
		FVector BestPoint = FVector::ZeroVector;
		for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
		{
			const ATacCharacter* Other = *It;
			if (Other == Me || !Other->IsAlive() || Other->GetTeam() == Me->GetTeam())
			{
				continue;
			}
			const FVector Point = Other->GetActorLocation() + FVector(0.f, 0.f, 20.f);
			const FVector ToTarget = Point - ViewLocation;
			const float Distance = ToTarget.Size();
			if (Distance < 50.f || Distance > AimAssistRange)
			{
				continue;
			}
			const double Cosine = FMath::Clamp<double>(FVector::DotProduct(ViewDirection, ToTarget / Distance), -1.0, 1.0);
			const float AngleDegrees = FMath::RadiansToDegrees(static_cast<float>(FMath::Acos(Cosine)));
			const float TargetDegrees = FMath::RadiansToDegrees(FMath::Atan2(AimAssistTargetRadius, Distance));
			const float OuterDegrees = TargetDegrees * 2.2f + 0.5f;
			if (AngleDegrees >= OuterDegrees)
			{
				continue;
			}
			const float Strength = 1.f - FMath::SmoothStep(TargetDegrees, OuterDegrees, AngleDegrees);
			if (Strength > BestStrength)
			{
				BestStrength = Strength;
				BestPoint = Point;
			}
		}

		if (BestStrength > 0.f)
		{
			// No help through walls or smoke.
			FCollisionQueryParams Params(SCENE_QUERY_STAT(TacAimAssist), false);
			for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
			{
				Params.AddIgnoredActor(*It);
			}
			if (!GetWorld()->LineTraceTestByChannel(ViewLocation, BestPoint, ECC_Camera, Params))
			{
				const float MaxSlowdown = Me->IsADS() ? AimAssistMaxSlowdownADS : AimAssistMaxSlowdown;
				TargetFriction = 1.f - BestStrength * MaxSlowdown * FMath::Clamp(Layout.AimAssistStrength, 0.f, 1.f);
			}
		}
	}

	// Ease in and out so the slowdown is felt as weight, not as a step.
	AimFriction = FMath::FInterpTo(AimFriction, TargetFriction, DeltaTime, 14.f);
}

// ---------------------------------------------------------------------------------------------
// Touch routing
// ---------------------------------------------------------------------------------------------

bool ATacPlayerController::InputTouch(uint32 Handle, ETouchType::Type Type, const FVector2D& TouchLocation, float Force, FDateTime DeviceTimestamp, uint32 TouchpadIndex)
{
	const bool bHandled = Super::InputTouch(Handle, Type, TouchLocation, Force, DeviceTimestamp, TouchpadIndex);

	if (Handle < static_cast<uint32>(MaxFingers))
	{
		const int32 Finger = static_cast<int32>(Handle);
		switch (Type)
		{
		case ETouchType::Began:
			HandleTouchBegan(Finger, TouchLocation);
			break;
		case ETouchType::Moved:
		case ETouchType::FirstMove:
			HandleTouchMoved(Finger, TouchLocation);
			break;
		case ETouchType::Ended:
			HandleTouchEnded(Finger);
			break;
		default:
			break;
		}
	}
	return bHandled;
}

void ATacPlayerController::HandleTouchBegan(int32 Finger, const FVector2D& Position)
{
	if (Fingers[Finger].bActive)
	{
		HandleTouchEnded(Finger); // the previous lift was missed
	}

	FTouchFinger& Touch = Fingers[Finger];
	Touch = FTouchFinger();
	Touch.bActive = true;
	Touch.LastPosition = Position;

	const FVector2D ViewportSize = GetViewportSizeF();
	if (ViewportSize.X < 1.f || ViewportSize.Y < 1.f)
	{
		return;
	}

	if (bLayoutEditMode)
	{
		Touch.Role = ETouchRole::EditDrag;
		Touch.Control = HitTestButtons(Position, ViewportSize, true);
		if (Touch.Control == INDEX_NONE
			&& FVector2D::Distance(Position, Layout.JoystickCenter * ViewportSize) <= Layout.JoystickRadius * ViewportSize.Y * 1.2f)
		{
			Touch.Control = JoystickEditId;
		}
		return;
	}

	const ATacCharacter* TacCharacter = GetTacCharacter();
	if (bBuyMenuOpen || !TacCharacter || !TacCharacter->IsAlive())
	{
		return;
	}

	// 1. Buttons win over everything else under the finger.
	const int32 Control = HitTestButtons(Position, ViewportSize, false);
	if (Control != INDEX_NONE && !IsControlPressed(static_cast<ETacTouchControl>(Control)))
	{
		Touch.Role = ETouchRole::Button;
		Touch.Control = Control;
		PressControl(static_cast<ETacTouchControl>(Control));
		return;
	}

	// 2. The first finger on the left side is the movement stick.
	if (MoveFinger == INDEX_NONE && Position.X < ViewportSize.X * Layout.MoveZoneWidth)
	{
		Touch.Role = ETouchRole::Move;
		MoveFinger = Finger;
		JoystickOrigin = Layout.bFloatingJoystick ? Position : Layout.JoystickCenter * ViewportSize;
		UpdateJoystick(Position, ViewportSize);
		return;
	}

	// 3. Anything else aims.
	Touch.Role = ETouchRole::Look;
}

void ATacPlayerController::HandleTouchMoved(int32 Finger, const FVector2D& Position)
{
	FTouchFinger& Touch = Fingers[Finger];
	if (!Touch.bActive)
	{
		return;
	}

	const FVector2D ViewportSize = GetViewportSizeF();
	const FVector2D Delta = Position - Touch.LastPosition;
	Touch.LastPosition = Position;
	if (ViewportSize.X < 1.f || ViewportSize.Y < 1.f)
	{
		return;
	}

	switch (Touch.Role)
	{
	case ETouchRole::Move:
		UpdateJoystick(Position, ViewportSize);
		break;

	case ETouchRole::Look:
		PendingLookPixels += Delta;
		break;

	case ETouchRole::Button:
		if (Touch.Control == static_cast<int32>(ETacTouchControl::Fire))
		{
			PendingLookPixels += Delta; // keep tracking the target while shooting
		}
		else if (Touch.Control == static_cast<int32>(ETacTouchControl::Grenade))
		{
			UpdateGrenadeWheel(Position, ViewportSize);
		}
		break;

	case ETouchRole::EditDrag:
	{
		const FVector2D Normalized(
			FMath::Clamp<double>(Position.X / ViewportSize.X, 0.03, 0.97),
			FMath::Clamp<double>(Position.Y / ViewportSize.Y, 0.05, 0.95));
		if (Touch.Control == JoystickEditId)
		{
			Layout.JoystickCenter = Normalized;
		}
		else if (Layout.Buttons.IsValidIndex(Touch.Control))
		{
			Layout.Buttons[Touch.Control].Center = Normalized;
		}
		break;
	}

	default:
		break;
	}
}

void ATacPlayerController::HandleTouchEnded(int32 Finger)
{
	const FTouchFinger Touch = Fingers[Finger];
	Fingers[Finger] = FTouchFinger();
	if (!Touch.bActive)
	{
		return;
	}

	switch (Touch.Role)
	{
	case ETouchRole::Move:
		MoveFinger = INDEX_NONE;
		JoystickValue = FVector2D::ZeroVector;
		JoystickThumbOffset = FVector2D::ZeroVector;
		break;

	case ETouchRole::Button:
		ReleaseControl(static_cast<ETacTouchControl>(Touch.Control));
		break;

	case ETouchRole::EditDrag:
		SaveLayout();
		break;

	default:
		break;
	}
}

void ATacPlayerController::ReleaseAllTouches()
{
	for (int32 Finger = 0; Finger < MaxFingers; ++Finger)
	{
		HandleTouchEnded(Finger);
	}
	PendingLookPixels = FVector2D::ZeroVector;
}

int32 ATacPlayerController::HitTestButtons(const FVector2D& Position, const FVector2D& ViewportSize, bool bIncludeHidden) const
{
	int32 Best = INDEX_NONE;
	float BestDistance = TNumericLimits<float>::Max();
	for (int32 Index = 0; Index < Layout.Buttons.Num(); ++Index)
	{
		if (!bIncludeHidden && !IsControlVisible(static_cast<ETacTouchControl>(Index)))
		{
			continue;
		}
		const FTacTouchButton& Button = Layout.Buttons[Index];
		const float Distance = FVector2D::Distance(Position, Button.Center * ViewportSize);
		// A slightly generous target: thumbs are not precise.
		if (Distance <= Button.Radius * ViewportSize.Y * 1.15f && Distance < BestDistance)
		{
			Best = Index;
			BestDistance = Distance;
		}
	}
	return Best;
}

void ATacPlayerController::UpdateJoystick(const FVector2D& Position, const FVector2D& ViewportSize)
{
	const float Radius = FMath::Max(Layout.JoystickRadius * static_cast<float>(ViewportSize.Y), 1.f);
	FVector2D Offset = Position - JoystickOrigin;
	float Length = Offset.Size();

	if (Length > Radius)
	{
		if (Layout.bFloatingJoystick)
		{
			// Drag the base along so the thumb never runs off the stick.
			JoystickOrigin += Offset * ((Length - Radius) / Length);
		}
		Offset *= Radius / Length;
		Length = Radius;
	}
	JoystickThumbOffset = Offset;

	const float Deflection = Length / Radius;
	if (Deflection <= Layout.JoystickDeadZone)
	{
		JoystickValue = FVector2D::ZeroVector;
		return;
	}
	const float Scaled = (Deflection - Layout.JoystickDeadZone) / (1.f - Layout.JoystickDeadZone);
	JoystickValue = Offset / Length * Scaled;
}

void ATacPlayerController::GetJoystickVisual(FVector2D& OutBase, FVector2D& OutThumb) const
{
	const FVector2D ViewportSize = GetViewportSizeF();
	if (MoveFinger == INDEX_NONE || ViewportSize.X < 1.f || ViewportSize.Y < 1.f)
	{
		OutBase = Layout.JoystickCenter;
		OutThumb = Layout.JoystickCenter;
		return;
	}
	OutBase = JoystickOrigin / ViewportSize;
	OutThumb = (JoystickOrigin + JoystickThumbOffset) / ViewportSize;
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

bool ATacPlayerController::IsControlVisible(ETacTouchControl Control) const
{
	if (bLayoutEditMode)
	{
		return true;
	}
	const ATacCharacter* TacCharacter = GetTacCharacter();
	if (!TacCharacter || !TacCharacter->IsAlive())
	{
		return false;
	}

	// Contextual buttons only appear when they can do something, to keep the screen clean.
	switch (Control)
	{
	case ETacTouchControl::Use:
		return IsControlPressed(Control) || TacCharacter->CanStartPlant() || TacCharacter->CanStartDefuse();
	case ETacTouchControl::Buy:
		return IsBuyAllowedLocally();
	case ETacTouchControl::Grenade:
		return IsControlPressed(Control) || TacCharacter->GetInventory().TotalGrenades() > 0;
	case ETacTouchControl::Swap:
		return TacCharacter->GetActiveSlot() == ETacWeaponSlot::Grenade
			|| (TacCharacter->GetWeaponInSlot(ETacWeaponSlot::Primary) && TacCharacter->GetWeaponInSlot(ETacWeaponSlot::Secondary));
	default:
		return true;
	}
}

void ATacPlayerController::PressControl(ETacTouchControl Control)
{
	PressedMask |= 1u << static_cast<uint32>(Control);

	ATacCharacter* TacCharacter = GetTacCharacter();
	if (!TacCharacter)
	{
		return;
	}

	switch (Control)
	{
	case ETacTouchControl::Fire:
		TacCharacter->StartFire();
		break;
	case ETacTouchControl::ADS:
		TacCharacter->SetADS(!TacCharacter->IsADS());
		break;
	case ETacTouchControl::Reload:
		TacCharacter->StartReload();
		break;
	case ETacTouchControl::Crouch:
		if (TacCharacter->bIsCrouched)
		{
			TacCharacter->UnCrouch();
		}
		else
		{
			TacCharacter->Crouch();
		}
		break;
	case ETacTouchControl::Jump:
		if (TacCharacter->bIsCrouched)
		{
			TacCharacter->UnCrouch();
		}
		TacCharacter->Jump();
		break;
	case ETacTouchControl::Grenade:
		bGrenadeWheelOpen = true;
		WheelSelection = INDEX_NONE;
		break;
	case ETacTouchControl::Swap:
		TacCharacter->SwapWeapon();
		break;
	case ETacTouchControl::Use:
		TacCharacter->SetUseHeld(true);
		break;
	case ETacTouchControl::Buy:
		SetBuyMenuOpen(!bBuyMenuOpen);
		break;
	default:
		break;
	}
}

void ATacPlayerController::ReleaseControl(ETacTouchControl Control)
{
	PressedMask &= ~(1u << static_cast<uint32>(Control));

	if (Control == ETacTouchControl::Grenade)
	{
		CommitGrenadeWheel();
		return;
	}

	ATacCharacter* TacCharacter = GetTacCharacter();
	if (!TacCharacter)
	{
		return;
	}

	switch (Control)
	{
	case ETacTouchControl::Fire:
		TacCharacter->StopFire();
		break;
	case ETacTouchControl::Jump:
		TacCharacter->StopJumping();
		break;
	case ETacTouchControl::Use:
		TacCharacter->SetUseHeld(false);
		break;
	default:
		break;
	}
}

FVector2D ATacPlayerController::GetGrenadeWheelDirection(int32 Option)
{
	// Fanned out up and to the left of the button, where the thumb naturally sweeps.
	switch (Option)
	{
	case 0: return FVector2D(-1.f, 0.f);              // flash
	case 1: return FVector2D(-0.7071f, -0.7071f);     // smoke
	default: return FVector2D(0.f, -1.f);             // HE
	}
}

void ATacPlayerController::UpdateGrenadeWheel(const FVector2D& Position, const FVector2D& ViewportSize)
{
	const FTacTouchButton& Button = Layout.Buttons[static_cast<int32>(ETacTouchControl::Grenade)];
	const FVector2D Offset = Position - Button.Center * ViewportSize;
	const float Length = Offset.Size();

	WheelSelection = INDEX_NONE;
	if (Length < Button.Radius * ViewportSize.Y * 0.9f)
	{
		return; // still on the button: a tap, not a selection
	}

	const FVector2D Direction = Offset / Length;
	float BestDot = 0.5f;
	for (int32 Option = 0; Option < 3; ++Option)
	{
		const float Dot = FVector2D::DotProduct(Direction, GetGrenadeWheelDirection(Option));
		if (Dot > BestDot)
		{
			BestDot = Dot;
			WheelSelection = Option;
		}
	}
}

void ATacPlayerController::CommitGrenadeWheel()
{
	bGrenadeWheelOpen = false;
	int32 Choice = WheelSelection;
	WheelSelection = INDEX_NONE;

	ATacCharacter* TacCharacter = GetTacCharacter();
	if (!TacCharacter)
	{
		return;
	}
	const FTacLoadout& Inventory = TacCharacter->GetInventory();

	// A plain tap cycles to the next grenade type the player is carrying.
	if (Choice == INDEX_NONE)
	{
		const int32 Current = TacCharacter->GetActiveSlot() == ETacWeaponSlot::Grenade ? static_cast<int32>(TacCharacter->GetSelectedGrenade()) : -1;
		for (int32 Step = 1; Step <= 3; ++Step)
		{
			const int32 Candidate = (Current + Step) % 3;
			if (Inventory.GetGrenadeCount(static_cast<ETacGrenadeType>(Candidate)) > 0)
			{
				Choice = Candidate;
				break;
			}
		}
	}

	if (Choice != INDEX_NONE && Inventory.GetGrenadeCount(static_cast<ETacGrenadeType>(Choice)) > 0)
	{
		TacCharacter->SelectGrenade(static_cast<ETacGrenadeType>(Choice));
	}
}

// ---------------------------------------------------------------------------------------------
// Layout customisation
// ---------------------------------------------------------------------------------------------

void ATacPlayerController::LoadLayout()
{
	Layout.SetDefaults();
	if (UGameplayStatics::DoesSaveGameExist(LayoutSaveSlot, 0))
	{
		const UTacTouchSettingsSave* Save = Cast<UTacTouchSettingsSave>(UGameplayStatics::LoadGameFromSlot(LayoutSaveSlot, 0));
		if (Save && Save->Layout.IsValidLayout())
		{
			Layout = Save->Layout;
		}
	}
}

void ATacPlayerController::SaveLayout() const
{
	UTacTouchSettingsSave* Save = Cast<UTacTouchSettingsSave>(UGameplayStatics::CreateSaveGameObject(UTacTouchSettingsSave::StaticClass()));
	if (Save)
	{
		Save->Layout = Layout;
		UGameplayStatics::SaveGameToSlot(Save, LayoutSaveSlot, 0);
	}
}

void ATacPlayerController::TacEditLayout(int32 bEnable)
{
	ReleaseAllTouches();
	bLayoutEditMode = bEnable != 0;
	if (!bLayoutEditMode)
	{
		SaveLayout();
	}
}

void ATacPlayerController::TacResetLayout()
{
	Layout.SetDefaults();
	SaveLayout();
}

void ATacPlayerController::TacScaleControl(int32 ControlIndex, float Scale)
{
	if (Layout.Buttons.IsValidIndex(ControlIndex))
	{
		FTacTouchButton& Button = Layout.Buttons[ControlIndex];
		Button.Radius = FMath::Clamp(Button.Radius * Scale, 0.03f, 0.14f);
		SaveLayout();
	}
}

void ATacPlayerController::TacSetSensitivity(float Sensitivity)
{
	Layout.LookSensitivity = FMath::Clamp(Sensitivity, 0.1f, 5.f);
	SaveLayout();
}

void ATacPlayerController::TacSetAimAssist(float Strength)
{
	Layout.AimAssistStrength = FMath::Clamp(Strength, 0.f, 1.f);
	SaveLayout();
}

// ---------------------------------------------------------------------------------------------
// Buy menu
// ---------------------------------------------------------------------------------------------

bool ATacPlayerController::IsBuyAllowedLocally() const
{
	const ATacCharacter* TacCharacter = GetTacCharacter();
	const ATacGameState* GameState = GetWorld() ? GetWorld()->GetGameState<ATacGameState>() : nullptr;
	if (!TacCharacter || !TacCharacter->IsAlive() || !GameState)
	{
		return false;
	}
	if (GameState->MatchType == ETacMatchType::TeamDeathmatch)
	{
		return GameState->Phase == ETacRoundPhase::Live
			&& GetWorld()->GetTimeSeconds() - TacCharacter->SpawnLocalTime <= DeathmatchBuyWindowSeconds;
	}
	return GameState->Phase == ETacRoundPhase::BuyPhase;
}

bool ATacPlayerController::CanAffordItem(FName ItemId) const
{
	const UTacWeaponCatalog* Catalog = UTacWeaponCatalog::Get(this);
	const ATacPlayerState* TacPlayerState = GetPlayerState<ATacPlayerState>();
	const ATacGameState* GameState = GetWorld() ? GetWorld()->GetGameState<ATacGameState>() : nullptr;
	const FTacBuyItem* Item = Catalog ? Catalog->FindBuyItem(ItemId) : nullptr;
	if (!Item || !TacPlayerState || !GameState || !IsBuyAllowedLocally())
	{
		return false;
	}
	if (Item->TeamOnly != ETacTeam::None && Item->TeamOnly != TacPlayerState->Team)
	{
		return false;
	}
	return GameState->MatchType == ETacMatchType::TeamDeathmatch || TacPlayerState->Money >= Item->Price;
}

void ATacPlayerController::RequestBuy(FName ItemId)
{
	if (CanAffordItem(ItemId))
	{
		ServerBuyItem(ItemId); // the server re-checks everything
	}
}

void ATacPlayerController::ServerBuyItem_Implementation(FName ItemId)
{
	if (ATacGameMode* GameMode = GetWorld()->GetAuthGameMode<ATacGameMode>())
	{
		GameMode->TryPurchase(this, ItemId);
	}
}

void ATacPlayerController::SetBuyMenuOpen(bool bOpen)
{
	if (bBuyMenuOpen == bOpen)
	{
		return;
	}
	bBuyMenuOpen = bOpen;
	ReleaseAllTouches();

#if PLATFORM_DESKTOP
	// Mouse testing in the editor needs a cursor and UI focus. On a phone the menu's buttons take touches as they are.
	bShowMouseCursor = bOpen;
	if (bOpen)
	{
		FInputModeGameAndUI Mode;
		Mode.SetHideCursorDuringCapture(false);
		SetInputMode(Mode);
	}
	else
	{
		SetInputMode(FInputModeGameOnly());
	}
#endif
}

// ---------------------------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------------------------

void ATacPlayerController::ClientFlashed_Implementation(float Duration, float Intensity)
{
	const float Now = GetWorld()->GetTimeSeconds();
	FlashEndTime = FMath::Max(FlashEndTime, Now + Duration);
	FlashFadeTime = FMath::Clamp(Duration * 0.5f, 0.2f, 1.2f);
	FlashIntensity = FMath::Clamp(Intensity, 0.f, 1.f);
}

float ATacPlayerController::GetFlashAlpha() const
{
	const float Remaining = FlashEndTime - (GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f);
	if (Remaining <= 0.f)
	{
		return 0.f;
	}
	return FlashIntensity * FMath::Clamp(Remaining / FlashFadeTime, 0.f, 1.f);
}

void ATacPlayerController::ClientHitConfirm_Implementation(bool bHeadshot, bool bKilled)
{
	LastHitMarkerTime = GetWorld()->GetTimeSeconds();
	bLastHitHeadshot = bHeadshot || bKilled;
}

float ATacPlayerController::GetHitMarkerAge() const
{
	return (GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f) - LastHitMarkerTime;
}

// ---------------------------------------------------------------------------------------------
// Spectating (server)
// ---------------------------------------------------------------------------------------------

void ATacPlayerController::BeginSpectating()
{
	if (!HasAuthority())
	{
		return;
	}
	bSpectating = true;
	ClientSetSpectating(true);
	UpdateSpectating();
}

void ATacPlayerController::UpdateSpectating()
{
	if (!HasAuthority() || !bSpectating || GetPawn())
	{
		return;
	}

	// Keep watching the same teammate while they live; otherwise move to another.
	const ATacCharacter* Current = Cast<ATacCharacter>(GetViewTarget());
	if (Current && Current->IsAlive() && Current->GetTeam() == GetTeam())
	{
		return;
	}
	for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
	{
		if (It->IsAlive() && It->GetTeam() == GetTeam())
		{
			SetViewTargetWithBlend(*It, 0.25f);
			return;
		}
	}
}

void ATacPlayerController::ClientSetSpectating_Implementation(bool bInSpectating)
{
	bSpectating = bInSpectating;
	if (bSpectating)
	{
		ReleaseAllTouches();
		SetBuyMenuOpen(false);
	}
}

// ---------------------------------------------------------------------------------------------
// Keyboard and mouse, for testing in the editor
// ---------------------------------------------------------------------------------------------

void ATacPlayerController::TickDesktopFallback(float DeltaTime, FVector2D& InOutMove, bool& bOutWalk)
{
#if PLATFORM_DESKTOP
	ATacCharacter* TacCharacter = GetTacCharacter();
	if (!TacCharacter)
	{
		return;
	}

	if (WasInputKeyJustPressed(EKeys::B))
	{
		SetBuyMenuOpen(!bBuyMenuOpen && IsBuyAllowedLocally());
	}
	if (bBuyMenuOpen)
	{
		return;
	}

	InOutMove.Y += (IsInputKeyDown(EKeys::W) ? 1.f : 0.f) - (IsInputKeyDown(EKeys::S) ? 1.f : 0.f);
	InOutMove.X += (IsInputKeyDown(EKeys::D) ? 1.f : 0.f) - (IsInputKeyDown(EKeys::A) ? 1.f : 0.f);
	bOutWalk = IsInputKeyDown(EKeys::LeftShift);

	// With "Use Mouse for Touch" on, the mouse drives the touch controls instead.
	if (!GetDefault<UInputSettings>()->bUseMouseForTouch)
	{
		const float MouseScale = 0.08f * Layout.LookSensitivity * (TacCharacter->IsADS() ? Layout.ADSSensitivityScale : 1.f);
		ApplyLook(GetInputAnalogKeyState(EKeys::MouseX) * MouseScale, GetInputAnalogKeyState(EKeys::MouseY) * MouseScale);

		if (WasInputKeyJustPressed(EKeys::LeftMouseButton))
		{
			TacCharacter->StartFire();
		}
		if (WasInputKeyJustReleased(EKeys::LeftMouseButton))
		{
			TacCharacter->StopFire();
		}
		if (WasInputKeyJustPressed(EKeys::RightMouseButton))
		{
			TacCharacter->SetADS(!TacCharacter->IsADS());
		}
	}

	if (WasInputKeyJustPressed(EKeys::R))
	{
		TacCharacter->StartReload();
	}
	if (WasInputKeyJustPressed(EKeys::SpaceBar))
	{
		TacCharacter->UnCrouch();
		TacCharacter->Jump();
	}
	if (WasInputKeyJustReleased(EKeys::SpaceBar))
	{
		TacCharacter->StopJumping();
	}
	if (WasInputKeyJustPressed(EKeys::LeftControl))
	{
		TacCharacter->Crouch();
	}
	if (WasInputKeyJustReleased(EKeys::LeftControl))
	{
		TacCharacter->UnCrouch();
	}
	if (WasInputKeyJustPressed(EKeys::E))
	{
		TacCharacter->SetUseHeld(true);
	}
	if (WasInputKeyJustReleased(EKeys::E))
	{
		TacCharacter->SetUseHeld(false);
	}
	if (WasInputKeyJustPressed(EKeys::Q))
	{
		TacCharacter->SwapWeapon();
	}
	if (WasInputKeyJustPressed(EKeys::G))
	{
		WheelSelection = INDEX_NONE;
		CommitGrenadeWheel();
	}
#endif
}
