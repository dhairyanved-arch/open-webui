#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TacTypes.h"
#include "TacGrenade.generated.h"

class USphereComponent;
class UStaticMeshComponent;
class UProjectileMovementComponent;
class UNiagaraSystem;
class USoundBase;

/** Thrown utility: flashbang, smoke or HE. Simulated and resolved on the server. */
UCLASS()
class TACSHOOTER_API ATacGrenade : public AActor
{
	GENERATED_BODY()

public:
	ATacGrenade();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	/** Server: sets the type, throws it and starts the fuse. */
	void Launch(ETacGrenadeType InType, const FVector& Velocity);

	UPROPERTY(VisibleAnywhere, Category = "Grenade")
	TObjectPtr<USphereComponent> Collision;

	/** Blocks line-of-sight checks (aim assist, flash) while smoke is active. Bullets pass through. */
	UPROPERTY(VisibleAnywhere, Category = "Grenade")
	TObjectPtr<USphereComponent> SmokeBlocker;

	UPROPERTY(VisibleAnywhere, Category = "Grenade")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY(VisibleAnywhere, Category = "Grenade")
	TObjectPtr<UProjectileMovementComponent> Projectile;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Effects")
	TObjectPtr<UNiagaraSystem> ExplosionEffect;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Effects")
	TObjectPtr<UNiagaraSystem> FlashEffect;

	/** Should be a looping system; it is attached to the grenade and ends with it. */
	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Effects")
	TObjectPtr<UNiagaraSystem> SmokeEffect;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Effects")
	TObjectPtr<USoundBase> DetonateSound;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Tuning")
	float HEDamage = 98.f;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Tuning")
	float HEInnerRadius = 150.f;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Tuning")
	float HEOuterRadius = 480.f;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Tuning")
	float FlashRadius = 1800.f;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Tuning")
	float FlashMaxDuration = 3.2f;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Tuning")
	float SmokeRadius = 320.f;

	UPROPERTY(EditDefaultsOnly, Category = "Grenade|Tuning")
	float SmokeDuration = 15.f;

	UPROPERTY(Replicated)
	ETacGrenadeType Type = ETacGrenadeType::HE;

	UPROPERTY(ReplicatedUsing = OnRep_SmokeActive)
	bool bSmokeActive = false;

	UFUNCTION()
	void OnRep_SmokeActive();

	UFUNCTION(NetMulticast, Reliable)
	void MulticastDetonate();

private:
	void Detonate();
	void DetonateFlash();

	FTimerHandle FuseTimer;
};
