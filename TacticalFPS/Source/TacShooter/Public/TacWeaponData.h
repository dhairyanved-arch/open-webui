#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Chaos/ChaosEngineInterface.h"
#include "TacTypes.h"
#include "TacWeaponData.generated.h"

class USkeletalMesh;
class UAnimMontage;
class UNiagaraSystem;
class USoundBase;

/**
 * Tuning and presentation data for one weapon.
 * Gameplay numbers are filled in code by UTacWeaponCatalog so the game is playable in greybox;
 * the presentation slots (mesh, montages, effects, sounds) are meant to be filled in the editor.
 */
UCLASS(BlueprintType)
class TACSHOOTER_API UTacWeaponData : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Identity")
	FName WeaponId;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Identity")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Identity")
	ETacWeaponSlot Slot = ETacWeaponSlot::Primary;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Identity")
	ETacBuyCategory Category = ETacBuyCategory::Rifles;

	/** None means both teams can buy it. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Identity")
	ETacTeam TeamOnly = ETacTeam::None;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Economy")
	int32 Price = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Economy")
	int32 KillReward = 300;

	// ---- Damage ----

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Damage")
	float BaseDamage = 30.f;

	/** Fraction of damage that reaches health through armor (0..1). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Damage")
	float ArmorPenetration = 0.7f;

	/** Damage multiplier applied per 10 m travelled. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Damage")
	float RangeModifier = 0.97f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Damage")
	float Range = 12000.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Damage")
	float HeadMultiplier = 4.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Damage")
	float StomachMultiplier = 1.25f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Damage")
	float LegMultiplier = 0.75f;

	// ---- Fire ----

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Fire")
	float RoundsPerMinute = 600.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Fire")
	bool bAutomatic = true;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Fire")
	int32 MagazineSize = 30;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Fire")
	int32 ReserveAmmo = 90;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Fire")
	float ReloadTime = 2.4f;

	// ---- Accuracy (cone half-angles in degrees) ----

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Accuracy")
	float SpreadStanding = 0.25f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Accuracy")
	float SpreadCrouching = 0.15f;

	/** Added at full run speed. Nothing is added below the walking speed, so walking and counter-strafing stay accurate. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Accuracy")
	float SpreadMovingAdd = 4.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Accuracy")
	float SpreadAirborneAdd = 8.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Accuracy")
	float SpreadADSMultiplier = 0.6f;

	// ---- Recoil ----

	/**
	 * The spray pattern: cumulative aim offset in degrees for each consecutive shot (X = yaw right, Y = pitch up).
	 * Entry 0 should be zero so the first shot goes exactly where the player aims.
	 * It is fixed, so players can learn it and counter it by dragging the opposite way.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Recoil")
	TArray<FVector2D> RecoilPattern;

	/** Shots of the spray recovered per second once the player stops firing. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Recoil")
	float RecoilRecoveryRate = 14.f;

	// ---- Handling ----

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Handling")
	float MoveSpeedMultiplier = 0.9f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Handling")
	float ADSMoveSpeedMultiplier = 0.6f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Handling")
	float ADSFieldOfView = 60.f;

	// ---- Presentation (assign in the editor) ----

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TSoftObjectPtr<USkeletalMesh> Mesh;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TObjectPtr<UAnimMontage> FireMontage;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TObjectPtr<UAnimMontage> ReloadMontage;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TObjectPtr<UNiagaraSystem> MuzzleFlash;

	/** The tracer system receives the bullet end point in a user vector parameter named "TracerEnd". */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TObjectPtr<UNiagaraSystem> Tracer;

	/** Impact effect per physical surface (stone, metal, wood are SurfaceType1..3 in DefaultEngine.ini). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TMap<TEnumAsByte<EPhysicalSurface>, TObjectPtr<UNiagaraSystem>> ImpactEffects;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TObjectPtr<UNiagaraSystem> DefaultImpactEffect;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TObjectPtr<UNiagaraSystem> FleshImpactEffect;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation")
	TObjectPtr<USoundBase> FireSound;

	float GetFireInterval() const { return 60.f / FMath::Max(RoundsPerMinute, 1.f); }

	/** Pattern offset for a whole shot index. */
	FVector2D GetRecoilOffset(int32 ShotIndex) const;

	/** Pattern offset for a fractional shot index, used to move the view smoothly along the pattern. */
	FVector2D GetRecoilOffsetSmooth(float ShotIndex) const;

	/**
	 * Fills RecoilPattern with a deterministic climb-then-sway shape:
	 * the muzzle rises towards ClimbDegrees over the first shots, then swings left and right.
	 */
	void GenerateRecoilPattern(int32 Shots, float ClimbDegrees, float SwayDegrees, float SwayFrequency, float DriftDegrees);
};

/** One row of the buy menu. */
struct FTacBuyItem
{
	FName Id;
	FText Name;
	int32 Price = 0;
	ETacBuyCategory Category = ETacBuyCategory::Gear;
	ETacTeam TeamOnly = ETacTeam::None;
};

/**
 * The arsenal. Built identically on server and clients, so weapons are replicated as ids
 * and resolved locally.
 */
UCLASS()
class TACSHOOTER_API UTacWeaponCatalog : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	static UTacWeaponCatalog* Get(const UObject* WorldContextObject);

	const UTacWeaponData* FindWeapon(FName WeaponId) const;
	const FTacBuyItem* FindBuyItem(FName ItemId) const;
	const TArray<FTacBuyItem>& GetBuyItems() const { return BuyItems; }

	/** Adds or replaces a weapon, for example one authored as a data asset in the editor. */
	void RegisterWeapon(UTacWeaponData* Weapon);

	static constexpr int32 ArmorPrice = 650;
	static constexpr int32 ArmorHelmetPrice = 1000;
	static constexpr int32 HelmetOnlyPrice = 350;

private:
	UTacWeaponData* AddWeapon(FName Id, const TCHAR* Name, ETacWeaponSlot Slot, ETacBuyCategory Category, int32 Price);
	void BuildDefaultArsenal();
	void RebuildBuyItems();

	UPROPERTY()
	TArray<TObjectPtr<UTacWeaponData>> Weapons;

	TArray<FTacBuyItem> BuyItems;
};
