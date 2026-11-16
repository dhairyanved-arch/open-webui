#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "TacTouchLayout.h"
#include "TacTypes.h"
#include "TacPlayerController.generated.h"

class ATacCharacter;

/**
 * Mobile touch input.
 *
 * Every finger is given one job when it lands and keeps it until it lifts:
 *   - on a button           -> that action (the fire button also aims while held, so you can track and shoot with one thumb)
 *   - on the left of screen -> the movement stick
 *   - anywhere else         -> drag to aim
 *
 * Touches are read straight from the engine's touch events rather than through UI widgets,
 * which keeps input latency to a single frame. The HUD only draws the controls.
 */
UCLASS()
class TACSHOOTER_API ATacPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	ATacPlayerController();

	virtual void BeginPlay() override;
	virtual void PlayerTick(float DeltaTime) override;
	virtual bool InputTouch(uint32 Handle, ETouchType::Type Type, const FVector2D& TouchLocation, float Force, FDateTime DeviceTimestamp, uint32 TouchpadIndex) override;
	virtual void OnPossess(APawn* InPawn) override;

	ATacCharacter* GetTacCharacter() const;
	ETacTeam GetTeam() const;

	// ---- Touch layout (read by the HUD, edited by the player) ----

	const FTacTouchLayout& GetTouchLayout() const { return Layout; }
	bool IsControlVisible(ETacTouchControl Control) const;
	bool IsControlPressed(ETacTouchControl Control) const { return (PressedMask & (1u << static_cast<uint32>(Control))) != 0; }

	/** Stick base and thumb positions as fractions of the viewport. */
	void GetJoystickVisual(FVector2D& OutBase, FVector2D& OutThumb) const;

	bool IsGrenadeWheelOpen() const { return bGrenadeWheelOpen; }
	int32 GetGrenadeWheelSelection() const { return WheelSelection; }
	/** Screen-space direction (y down) from the grenade button to wheel option 0..2 (flash, smoke, HE). */
	static FVector2D GetGrenadeWheelDirection(int32 Option);

	/** While on, dragging a control moves it. Console: TacEditLayout 1 / 0. */
	UFUNCTION(Exec)
	void TacEditLayout(int32 bEnable);

	UFUNCTION(Exec)
	void TacResetLayout();

	/** Scales one control's size. Console: TacScaleControl <index> <scale>. */
	UFUNCTION(Exec)
	void TacScaleControl(int32 ControlIndex, float Scale);

	UFUNCTION(Exec)
	void TacSetSensitivity(float Sensitivity);

	UFUNCTION(Exec)
	void TacSetAimAssist(float Strength);

	bool IsLayoutEditMode() const { return bLayoutEditMode; }
	void SaveLayout() const;

	// ---- Buy menu ----

	bool IsBuyMenuOpen() const { return bBuyMenuOpen; }
	void SetBuyMenuOpen(bool bOpen);
	bool IsBuyAllowedLocally() const;
	bool CanAffordItem(FName ItemId) const;
	void RequestBuy(FName ItemId);

	// ---- HUD feedback ----

	/** 0..1 opacity of the white-out from a flashbang. */
	float GetFlashAlpha() const;
	float GetHitMarkerAge() const;
	bool WasLastHitHeadshot() const { return bLastHitHeadshot; }
	bool IsSpectating() const { return bSpectating; }

	// ---- Server ----

	void BeginSpectating();
	void UpdateSpectating();

	UFUNCTION(Client, Reliable)
	void ClientFlashed(float Duration, float Intensity);

	UFUNCTION(Client, Unreliable)
	void ClientHitConfirm(bool bHeadshot, bool bKilled);

	UFUNCTION(Client, Reliable)
	void ClientSetSpectating(bool bInSpectating);

protected:
	UFUNCTION(Server, Reliable)
	void ServerBuyItem(FName ItemId);

private:
	enum class ETouchRole : uint8
	{
		None,
		Move,
		Look,
		Button,   // includes Fire, which also aims
		EditDrag
	};

	struct FTouchFinger
	{
		bool bActive = false;
		ETouchRole Role = ETouchRole::None;
		int32 Control = INDEX_NONE; // ETacTouchControl for Button; -2 for the joystick in edit mode
		FVector2D LastPosition = FVector2D::ZeroVector;
	};

	static constexpr int32 MaxFingers = 10;
	static constexpr int32 JoystickEditId = -2;

	void HandleTouchBegan(int32 Finger, const FVector2D& Position);
	void HandleTouchMoved(int32 Finger, const FVector2D& Position);
	void HandleTouchEnded(int32 Finger);
	void ReleaseAllTouches();

	void PressControl(ETacTouchControl Control);
	void ReleaseControl(ETacTouchControl Control);
	int32 HitTestButtons(const FVector2D& Position, const FVector2D& ViewportSize, bool bIncludeHidden) const;
	void UpdateJoystick(const FVector2D& Position, const FVector2D& ViewportSize);
	void UpdateGrenadeWheel(const FVector2D& Position, const FVector2D& ViewportSize);
	void CommitGrenadeWheel();

	void ApplyMovement(const FVector2D& MoveInput, bool bForceWalk);
	void ApplyLook(float YawDegrees, float PitchDegrees);
	void ConsumeTouchLook(float DeltaTime);
	void UpdateAimAssist(float DeltaTime);
	void TickDesktopFallback(float DeltaTime, FVector2D& InOutMove, bool& bOutWalk);

	FVector2D GetViewportSizeF() const;
	void LoadLayout();

	FTacTouchLayout Layout;
	FTouchFinger Fingers[MaxFingers];
	uint32 PressedMask = 0;

	int32 MoveFinger = INDEX_NONE;
	FVector2D JoystickOrigin = FVector2D::ZeroVector; // pixels
	FVector2D JoystickValue = FVector2D::ZeroVector;  // x right, y down, length 0..1
	FVector2D JoystickThumbOffset = FVector2D::ZeroVector; // pixels from the origin, for drawing

	FVector2D PendingLookPixels = FVector2D::ZeroVector;

	/** Multiplier on look input from aim assist: 1 = untouched, lower = slowed. */
	float AimFriction = 1.f;

	bool bGrenadeWheelOpen = false;
	int32 WheelSelection = INDEX_NONE;

	bool bLayoutEditMode = false;
	bool bBuyMenuOpen = false;
	bool bSpectating = false;

	float FlashEndTime = 0.f;
	float FlashFadeTime = 1.f;
	float FlashIntensity = 0.f;

	float LastHitMarkerTime = -100.f;
	bool bLastHitHeadshot = false;
};
