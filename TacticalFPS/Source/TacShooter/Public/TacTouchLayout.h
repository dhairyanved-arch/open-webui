#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "TacTouchLayout.generated.h"

/** On-screen action buttons. The order is the index into FTacTouchLayout::Buttons. */
UENUM()
enum class ETacTouchControl : uint8
{
	Fire,
	ADS,
	Reload,
	Crouch,
	Jump,
	Grenade,
	Swap,
	Use,
	Buy,
	MAX UMETA(Hidden)
};

USTRUCT()
struct FTacTouchButton
{
	GENERATED_BODY()

	/** Centre as a fraction of the viewport (0,0 = top left, 1,1 = bottom right). */
	UPROPERTY()
	FVector2D Center = FVector2D(0.5f, 0.5f);

	/** Radius as a fraction of the viewport height. */
	UPROPERTY()
	float Radius = 0.05f;
};

/**
 * Everything a player can customise about the touch controls. All positions are fractions of
 * the viewport, so one layout fits every screen size and aspect ratio. Saved per device.
 */
USTRUCT()
struct FTacTouchLayout
{
	GENERATED_BODY()

	// ---- Movement stick (left side) ----

	UPROPERTY()
	FVector2D JoystickCenter = FVector2D(0.16f, 0.70f);

	UPROPERTY()
	float JoystickRadius = 0.13f;

	UPROPERTY()
	float JoystickDeadZone = 0.12f;

	/** Floating: the stick re-centres wherever the thumb lands and follows it if dragged past the rim. */
	UPROPERTY()
	bool bFloatingJoystick = true;

	/** Touches left of this fraction of the screen width drive the stick. */
	UPROPERTY()
	float MoveZoneWidth = 0.42f;

	/** Stick deflection below this is a silent walk; beyond it is a run. */
	UPROPERTY()
	float WalkThreshold = 0.6f;

	// ---- Aiming (right side) ----

	/** 1.0 turns the view 120 degrees for a swipe as long as the screen is tall. */
	UPROPERTY()
	float LookSensitivity = 1.f;

	UPROPERTY()
	float VerticalSensitivityScale = 0.75f;

	UPROPERTY()
	float ADSSensitivityScale = 0.8f;

	/** Extra turn rate for fast swipes (0 = none). Slow, precise drags are never accelerated. */
	UPROPERTY()
	float LookAcceleration = 0.35f;

	/** 0 = off, 1 = full. Only ever slows the reticle near a target; it never moves it. */
	UPROPERTY()
	float AimAssistStrength = 1.f;

	// ---- Buttons ----

	UPROPERTY()
	TArray<FTacTouchButton> Buttons;

	UPROPERTY()
	float Opacity = 0.55f;

	void SetDefaults()
	{
		*this = FTacTouchLayout();
		Buttons.SetNum(static_cast<int32>(ETacTouchControl::MAX));
		auto Place = [this](ETacTouchControl Control, float X, float Y, float Radius)
		{
			FTacTouchButton& Button = Buttons[static_cast<int32>(Control)];
			Button.Center = FVector2D(X, Y);
			Button.Radius = Radius;
		};
		// Arranged around the right thumb: fire under it, everything else one short reach away.
		Place(ETacTouchControl::Fire,    0.870f, 0.650f, 0.085f);
		Place(ETacTouchControl::ADS,     0.955f, 0.450f, 0.055f);
		Place(ETacTouchControl::Jump,    0.940f, 0.860f, 0.055f);
		Place(ETacTouchControl::Crouch,  0.835f, 0.880f, 0.055f);
		Place(ETacTouchControl::Reload,  0.765f, 0.730f, 0.050f);
		Place(ETacTouchControl::Grenade, 0.725f, 0.900f, 0.050f);
		Place(ETacTouchControl::Swap,    0.630f, 0.920f, 0.045f);
		Place(ETacTouchControl::Use,     0.500f, 0.740f, 0.060f);
		Place(ETacTouchControl::Buy,     0.270f, 0.090f, 0.045f);
	}

	bool IsValidLayout() const { return Buttons.Num() == static_cast<int32>(ETacTouchControl::MAX); }
};

UCLASS()
class TACSHOOTER_API UTacTouchSettingsSave : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY()
	FTacTouchLayout Layout;
};
