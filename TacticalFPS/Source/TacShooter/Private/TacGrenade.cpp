#include "TacGrenade.h"
#include "TacCharacter.h"
#include "TacPlayerController.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "TimerManager.h"
#include "GameFramework/DamageType.h"
#include "Kismet/GameplayStatics.h"
#include "Net/UnrealNetwork.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Sound/SoundBase.h"

ATacGrenade::ATacGrenade()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = true;
	SetReplicatingMovement(true);

	Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
	Collision->InitSphereRadius(6.f);
	Collision->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Collision->SetCollisionObjectType(ECC_WorldDynamic);
	Collision->SetCollisionResponseToAllChannels(ECR_Block);
	Collision->SetCollisionResponseToChannel(ECC_Pawn, ECR_Ignore);
	Collision->SetCollisionResponseToChannel(ECC_Camera, ECR_Ignore);
	Collision->SetCollisionResponseToChannel(ECC_Visibility, ECR_Ignore);
	RootComponent = Collision;

	SmokeBlocker = CreateDefaultSubobject<USphereComponent>(TEXT("SmokeBlocker"));
	SmokeBlocker->SetupAttachment(RootComponent);
	SmokeBlocker->InitSphereRadius(320.f);
	SmokeBlocker->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	SmokeBlocker->SetCollisionObjectType(ECC_WorldDynamic);
	SmokeBlocker->SetCollisionResponseToAllChannels(ECR_Ignore);
	SmokeBlocker->SetCollisionResponseToChannel(ECC_Camera, ECR_Block);

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(RootComponent);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	Projectile = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("Projectile"));
	Projectile->UpdatedComponent = Collision;
	Projectile->InitialSpeed = 0.f;
	Projectile->MaxSpeed = 3000.f;
	Projectile->bShouldBounce = true;
	Projectile->Bounciness = 0.4f;
	Projectile->Friction = 0.5f;
	Projectile->ProjectileGravityScale = 1.f;
}

void ATacGrenade::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(ATacGrenade, Type);
	DOREPLIFETIME(ATacGrenade, bSmokeActive);
}

void ATacGrenade::Launch(ETacGrenadeType InType, const FVector& Velocity)
{
	if (!HasAuthority())
	{
		return;
	}
	Type = InType;
	Projectile->Velocity = Velocity;

	const float Fuse = Type == ETacGrenadeType::Smoke ? 2.4f : 1.6f;
	GetWorldTimerManager().SetTimer(FuseTimer, this, &ATacGrenade::Detonate, Fuse, false);
}

void ATacGrenade::Detonate()
{
	Projectile->StopMovementImmediately();

	switch (Type)
	{
	case ETacGrenadeType::HE:
	{
		TArray<AActor*> Ignored;
		Ignored.Add(this);
		UGameplayStatics::ApplyRadialDamageWithFalloff(this, HEDamage, 1.f, GetActorLocation(), HEInnerRadius, HEOuterRadius, 1.f,
			UDamageType::StaticClass(), Ignored, this, GetInstigatorController(), ECC_Visibility);
		MulticastDetonate();
		SetActorHiddenInGame(true);
		SetLifeSpan(1.5f);
		break;
	}
	case ETacGrenadeType::Flash:
		DetonateFlash();
		MulticastDetonate();
		SetActorHiddenInGame(true);
		SetLifeSpan(1.5f);
		break;

	case ETacGrenadeType::Smoke:
		bSmokeActive = true;
		OnRep_SmokeActive();
		MulticastDetonate();
		SetLifeSpan(SmokeDuration);
		break;
	}
}

void ATacGrenade::DetonateFlash()
{
	const FVector Origin = GetActorLocation() + FVector(0.f, 0.f, 8.f);

	FCollisionQueryParams Params(SCENE_QUERY_STAT(TacFlashLOS), false, this);
	for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
	{
		Params.AddIgnoredActor(*It);
	}

	// Flashes blind everyone who can see them, teammates and the thrower included.
	for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
	{
		ATacCharacter* Character = *It;
		if (!Character->IsAlive())
		{
			continue;
		}
		const FVector Eye = Character->GetPawnViewLocation();
		const float Distance = FVector::Dist(Eye, Origin);
		if (Distance > FlashRadius)
		{
			continue;
		}
		// Walls and active smoke both block the Camera channel.
		if (GetWorld()->LineTraceTestByChannel(Origin, Eye, ECC_Camera, Params))
		{
			continue;
		}

		const FVector ViewDirection = Character->GetBaseAimRotation().Vector();
		const float Facing = FVector::DotProduct(ViewDirection, (Origin - Eye).GetSafeNormal());
		const float FacingScale = FMath::Lerp(0.25f, 1.f, FMath::Clamp((Facing + 0.35f) / 1.1f, 0.f, 1.f));
		const float DistanceScale = 1.f - 0.6f * (Distance / FlashRadius);

		if (ATacPlayerController* PC = Cast<ATacPlayerController>(Character->GetController()))
		{
			PC->ClientFlashed(FlashMaxDuration * FacingScale * DistanceScale, Facing > 0.f ? 1.f : 0.6f);
		}
	}
}

void ATacGrenade::OnRep_SmokeActive()
{
	if (!bSmokeActive)
	{
		return;
	}
	SmokeBlocker->SetSphereRadius(SmokeRadius);
	SmokeBlocker->SetCollisionEnabled(ECollisionEnabled::QueryOnly);

	// Driven by replicated state rather than an RPC, so players who join or come into range later still see the smoke.
	if (GetNetMode() != NM_DedicatedServer && SmokeEffect)
	{
		UNiagaraFunctionLibrary::SpawnSystemAttached(SmokeEffect, RootComponent, NAME_None, FVector::ZeroVector, FRotator::ZeroRotator,
			EAttachLocation::KeepRelativeOffset, true);
	}
}

void ATacGrenade::MulticastDetonate_Implementation()
{
	if (GetNetMode() == NM_DedicatedServer)
	{
		return;
	}
	UNiagaraSystem* Effect = Type == ETacGrenadeType::HE ? ExplosionEffect : (Type == ETacGrenadeType::Flash ? FlashEffect : nullptr);
	if (Effect)
	{
		UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, Effect, GetActorLocation());
	}
	if (DetonateSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, DetonateSound, GetActorLocation());
	}
}
