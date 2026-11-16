#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "Engine/NetSerialization.h"
#include "TacTypes.h"
#include "TacCharacter.generated.h"

class UCameraComponent;
class USkeletalMeshComponent;
class USoundBase;
class UTacWeaponData;
class UTacLagCompensationComponent;
class UTacCharacterMovementComponent;
class ATacGrenade;

/**
 * The operative: health and armor, inventory, gunplay (fixed spray patterns, spread, low time-to-kill),
 * server-side hit registration with lag compensation, grenades, and planting / defusing.
 *
 * Shots are predicted on the owning client for feel (ammo, recoil, tracer) and decided on the server.
 */
UCLASS()
class TACSHOOTER_API ATacCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ATacCharacter(const FObjectInitializer& ObjectInitializer);

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void PossessedBy(AController* NewController) override;
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
	virtual float TakeDamage(float DamageAmount, const FDamageEvent& DamageEvent, AController* EventInstigator, AActor* DamageCauser) override;
	virtual void OnStartCrouch(float HalfHeightAdjust, float ScaledHalfHeightAdjust) override;
	virtual void OnEndCrouch(float HalfHeightAdjust, float ScaledHalfHeightAdjust) override;

	// ---- Components ----

	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<UCameraComponent> Camera;

	/** First-person arms, seen only by the owner. */
	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<USkeletalMeshComponent> ArmsMesh;

	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<USkeletalMeshComponent> FirstPersonWeaponMesh;

	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<USkeletalMeshComponent> ThirdPersonWeaponMesh;

	UPROPERTY(VisibleAnywhere, Category = "Components")
	TObjectPtr<UTacLagCompensationComponent> LagCompensation;

	// ---- Tuning ----

	UPROPERTY(EditDefaultsOnly, Category = "Tac")
	float DefaultFieldOfView = 85.f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac")
	float EquipTime = 0.4f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac|Objective")
	float PlantTime = 3.2f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac|Objective")
	float DefuseTime = 10.f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac|Objective")
	float DefuseTimeWithKit = 5.f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac|Objective")
	float DefuseRange = 160.f;

	/** Upper bound on how far back the server rewinds targets for one shot. */
	UPROPERTY(EditDefaultsOnly, Category = "Tac|Netcode")
	float MaxRewindSeconds = 0.25f;

	/** How far behind the server other players are drawn on a client (movement smoothing). */
	UPROPERTY(EditDefaultsOnly, Category = "Tac|Netcode")
	float InterpolationDelay = 0.05f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac|Audio")
	TObjectPtr<USoundBase> FootstepSound;

	UPROPERTY(EditDefaultsOnly, Category = "Tac|Audio")
	float FootstepStride = 150.f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac|Audio")
	float FootstepHearingRadius = 1500.f;

	UPROPERTY(EditDefaultsOnly, Category = "Tac")
	TSubclassOf<ATacGrenade> GrenadeClass;

	// ---- State ----

	bool IsAlive() const { return !bIsDead; }
	ETacTeam GetTeam() const { return Team; }
	float GetHealth() const { return Health; }
	int32 GetArmor() const { return Inventory.Armor; }
	const FTacLoadout& GetInventory() const { return Inventory; }
	ETacWeaponSlot GetActiveSlot() const { return ActiveSlot; }
	ETacGrenadeType GetSelectedGrenade() const { return SelectedGrenade; }
	bool IsReloading() const { return bIsReloading; }
	bool IsADS() const;
	bool IsMovementLocked() const;
	FVector GetFeetLocation() const;

	const UTacWeaponData* GetWeaponInSlot(ETacWeaponSlot Slot) const;
	const UTacWeaponData* GetActiveWeapon() const;
	int32 GetMagAmmo() const;
	int32 GetReserveAmmo() const;
	float GetWeaponSpeedMultiplier(bool bAiming) const;

	/** Current bullet cone half-angle in degrees. Drives both the shot and the crosshair gap. */
	float GetCurrentSpreadDegrees() const;

	bool CanStartPlant() const;
	bool CanStartDefuse() const;
	float GetUseProgress() const { return UseProgress; }

	/** Minimap: when and where this character last made a noise the local player could hear. */
	float LastRevealTime = -100.f;
	FVector LastRevealLocation = FVector::ZeroVector;

	/** Local time this character appeared, for the deathmatch buy window. */
	float SpawnLocalTime = 0.f;

	// ---- Input, called by the owning player controller ----

	void StartFire();
	void StopFire();
	void StartReload();
	void SetADS(bool bAiming);
	void SetWalking(bool bWalking);
	void SelectSlot(ETacWeaponSlot Slot);
	void SelectGrenade(ETacGrenadeType Type);
	void SwapWeapon();
	void SetUseHeld(bool bHeld);

	// ---- Server ----

	void InitFromLoadout(const FTacLoadout& Loadout);
	void GiveWeapon(const UTacWeaponData* Weapon);
	void GiveArmor(bool bWithHelmet);
	void AddGrenade(ETacGrenadeType Type);
	void GiveDefuseKit();
	void ApplyDamageInternal(float Damage, float ArmorPenetration, bool bHeadshot, AController* InstigatorController, FName WeaponId);

protected:
	UFUNCTION(Server, Reliable)
	void ServerFire(const FVector_NetQuantize& Origin, const FVector_NetQuantizeNormal& AimDirection);

	UFUNCTION(Server, Reliable)
	void ServerReload();

	UFUNCTION(Server, Reliable)
	void ServerSelectSlot(ETacWeaponSlot Slot, ETacGrenadeType Grenade);

	UFUNCTION(Server, Reliable)
	void ServerThrowGrenade(const FVector_NetQuantizeNormal& AimDirection);

	UFUNCTION(Server, Reliable)
	void ServerSetUseHeld(bool bHeld);

	UFUNCTION(Client, Reliable)
	void ClientSetAmmo(uint8 Slot, int32 Mag, int32 Reserve);

	UFUNCTION(NetMulticast, Unreliable)
	void MulticastFireFX(const FVector_NetQuantize& End, uint8 Surface, bool bImpact);

	UFUNCTION()
	void OnRep_Loadout();

	UFUNCTION()
	void OnRep_IsDead();

	UFUNCTION()
	void OnRep_Reloading();

private:
	void TryFire();
	void PredictShot(const UTacWeaponData* Weapon, const FVector& Origin, const FVector& AimDirection);
	void ProcessShot(const FVector& ClientOrigin, const FVector& AimDirection);
	FVector2D ConsumeRecoilShot(const UTacWeaponData* Weapon);
	FVector BuildShotDirection(const FVector& AimDirection, const FVector2D& RecoilOffset, float SpreadDegrees) const;
	float GetRewindSeconds() const;
	void PlayFireFX(const FVector& End, uint8 Surface, bool bImpact);
	FVector GetMuzzleLocation() const;

	bool CanReload() const;
	void FinishReload();
	bool CanUseSlot(ETacWeaponSlot Slot, ETacGrenadeType Grenade) const;
	void RequestSlot(ETacWeaponSlot Slot, ETacGrenadeType Grenade);
	void ApplySlot(ETacWeaponSlot Slot, ETacGrenadeType Grenade);
	void RefreshWeaponVisuals();
	void SyncAmmoToOwner(ETacWeaponSlot Slot);

	void UpdateRecoil(float DeltaSeconds);
	void UpdateCamera(float DeltaSeconds);
	void UpdateFootsteps(float DeltaSeconds);
	void ServerTickUse(float DeltaSeconds);
	void MarkRevealed();
	void Die(AController* Killer, FName WeaponId, bool bHeadshot);

	UTacCharacterMovementComponent* GetTacMovement() const;

	// ---- Replicated ----

	UPROPERTY(Replicated)
	float Health = 100.f;

	UPROPERTY(ReplicatedUsing = OnRep_Loadout)
	FTacLoadout Inventory;

	UPROPERTY(ReplicatedUsing = OnRep_Loadout)
	ETacWeaponSlot ActiveSlot = ETacWeaponSlot::Secondary;

	UPROPERTY(Replicated)
	ETacGrenadeType SelectedGrenade = ETacGrenadeType::HE;

	UPROPERTY(ReplicatedUsing = OnRep_Reloading)
	bool bIsReloading = false;

	UPROPERTY(ReplicatedUsing = OnRep_IsDead)
	bool bIsDead = false;

	UPROPERTY(Replicated)
	ETacTeam Team = ETacTeam::None;

	/** True while planting or defusing: the character cannot move or shoot. */
	UPROPERTY(Replicated)
	bool bActionLocked = false;

	UPROPERTY(Replicated)
	float UseProgress = 0.f;

	// ---- Ammo: both sides count shots; the server corrects the owner at reload, equip and on a rejected shot ----

	int32 MagAmmo[2] = { 0, 0 };
	int32 ReserveAmmo[2] = { 0, 0 };

	// ---- Firing ----

	bool bWantsToFire = false;
	bool bFiredSincePress = false;
	float NextFireTime = 0.f;

	/** Position in the spray pattern. Rises by one per shot and falls back while not firing. */
	float SprayIndex = 0.f;
	float LastShotTime = -100.f;

	/** Smoothed view offset in degrees that follows the spray pattern (X yaw, Y pitch). */
	FVector2D AimPunch = FVector2D::ZeroVector;

	// Server-side fire-rate check: a small token bucket that tolerates network jitter.
	float ShotCredit = 1.f;
	float LastCreditTime = 0.f;
	float FireBlockedUntil = 0.f;

	float ReloadEndTime = 0.f;

	bool bUseHeld = false;
	float UseTime = 0.f;

	float StandingEyeHeight = 74.f;
	float CrouchCameraOffset = 0.f;
	float StepDistance = 0.f;
};
