#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TacTypes.h"
#include "TacBomb.generated.h"

class UBoxComponent;
class UStaticMeshComponent;
class UNiagaraSystem;
class USoundBase;
class ATacCharacter;

/** A plant zone. Place one or more in the level and give each a short name ("A", "B"). */
UCLASS()
class TACSHOOTER_API ATacBombSite : public AActor
{
	GENERATED_BODY()

public:
	ATacBombSite();

	UPROPERTY(VisibleAnywhere, Category = "Bomb Site")
	TObjectPtr<UBoxComponent> Zone;

	UPROPERTY(EditAnywhere, Category = "Bomb Site")
	FName SiteName = TEXT("A");

	bool ContainsPoint(const FVector& WorldPoint) const;

	static ATacBombSite* FindSiteAt(const UWorld* World, const FVector& WorldPoint);
};

UENUM()
enum class ETacBombState : uint8
{
	Carried,
	Dropped,
	Planted,
	Defused,
	Exploded
};

/** The single bomb of a defusal round. One actor covers every state from carried to exploded. */
UCLASS()
class TACSHOOTER_API ATacBomb : public AActor
{
	GENERATED_BODY()

public:
	ATacBomb();

	virtual void Tick(float DeltaSeconds) override;
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	UPROPERTY(VisibleAnywhere, Category = "Bomb")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb")
	TObjectPtr<UNiagaraSystem> ExplosionEffect;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb")
	TObjectPtr<USoundBase> ExplosionSound;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb")
	TObjectPtr<USoundBase> BeepSound;

	UPROPERTY(EditDefaultsOnly, Category = "Bomb")
	float PickupRadius = 110.f;

	UPROPERTY(ReplicatedUsing = OnRep_State)
	ETacBombState State = ETacBombState::Dropped;

	UPROPERTY(Replicated)
	TObjectPtr<ATacCharacter> Carrier;

	UPROPERTY(Replicated)
	FName PlantedSite;

	// Server only.
	void GiveTo(ATacCharacter* NewCarrier);
	void Drop(const FVector& FeetLocation);
	void Plant(ATacCharacter* Planter, FName Site);
	void Defuse();
	void Explode();

	UFUNCTION()
	void OnRep_State();

	UFUNCTION(NetMulticast, Reliable)
	void MulticastExplode();

private:
	void RefreshVisibility();

	float NextPickupCheckTime = 0.f;
	float NextBeepTime = 0.f;
	float PlantedLocalTime = 0.f;
};
