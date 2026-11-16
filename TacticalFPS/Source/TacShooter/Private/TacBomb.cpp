#include "TacBomb.h"
#include "TacCharacter.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/DamageType.h"
#include "Kismet/GameplayStatics.h"
#include "Net/UnrealNetwork.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Sound/SoundBase.h"

ATacBombSite::ATacBombSite()
{
	PrimaryActorTick.bCanEverTick = false;

	Zone = CreateDefaultSubobject<UBoxComponent>(TEXT("Zone"));
	Zone->InitBoxExtent(FVector(400.f, 400.f, 150.f));
	Zone->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	RootComponent = Zone;
}

bool ATacBombSite::ContainsPoint(const FVector& WorldPoint) const
{
	const FVector Local = Zone->GetComponentTransform().InverseTransformPosition(WorldPoint);
	const FVector Extent = Zone->GetUnscaledBoxExtent();
	return FMath::Abs(Local.X) <= Extent.X && FMath::Abs(Local.Y) <= Extent.Y && FMath::Abs(Local.Z) <= Extent.Z;
}

ATacBombSite* ATacBombSite::FindSiteAt(const UWorld* World, const FVector& WorldPoint)
{
	if (!World)
	{
		return nullptr;
	}
	for (TActorIterator<ATacBombSite> It(World); It; ++It)
	{
		if (It->ContainsPoint(WorldPoint))
		{
			return *It;
		}
	}
	return nullptr;
}

ATacBomb::ATacBomb()
{
	PrimaryActorTick.bCanEverTick = true;
	bReplicates = true;
	bAlwaysRelevant = true;
	SetReplicatingMovement(true);

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	RootComponent = Mesh;
}

void ATacBomb::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(ATacBomb, State);
	DOREPLIFETIME(ATacBomb, Carrier);
	DOREPLIFETIME(ATacBomb, PlantedSite);
}

void ATacBomb::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const float Now = GetWorld()->GetTimeSeconds();

	// A dropped bomb is picked up by the first living attacker who walks over it.
	if (HasAuthority() && State == ETacBombState::Dropped && Now >= NextPickupCheckTime)
	{
		NextPickupCheckTime = Now + 0.15f;
		for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
		{
			ATacCharacter* Character = *It;
			if (Character->IsAlive() && Character->GetTeam() == ETacTeam::Attackers
				&& FVector::DistSquared(Character->GetActorLocation(), GetActorLocation()) < FMath::Square(PickupRadius + 90.f))
			{
				GiveTo(Character);
				break;
			}
		}
	}

	// The beep speeds up as the timer runs down. Clients only.
	if (State == ETacBombState::Planted && GetNetMode() != NM_DedicatedServer && BeepSound && Now >= NextBeepTime)
	{
		const float Elapsed = Now - PlantedLocalTime;
		NextBeepTime = Now + FMath::Clamp(1.f - Elapsed * 0.022f, 0.12f, 1.f);
		UGameplayStatics::PlaySoundAtLocation(this, BeepSound, GetActorLocation());
	}
}

void ATacBomb::GiveTo(ATacCharacter* NewCarrier)
{
	if (!HasAuthority() || !NewCarrier)
	{
		return;
	}
	Carrier = NewCarrier;
	State = ETacBombState::Carried;
	OnRep_State();
	ForceNetUpdate();
}

void ATacBomb::Drop(const FVector& FeetLocation)
{
	if (!HasAuthority() || State != ETacBombState::Carried)
	{
		return;
	}
	Carrier = nullptr;
	State = ETacBombState::Dropped;
	SetActorLocation(FeetLocation);
	// Give the previous carrier a moment to move off it.
	NextPickupCheckTime = GetWorld()->GetTimeSeconds() + 1.f;
	OnRep_State();
	ForceNetUpdate();
}

void ATacBomb::Plant(ATacCharacter* Planter, FName Site)
{
	if (!HasAuthority() || State != ETacBombState::Carried || !Planter)
	{
		return;
	}
	Carrier = nullptr;
	PlantedSite = Site;
	State = ETacBombState::Planted;
	SetActorLocation(Planter->GetFeetLocation());
	OnRep_State();
	ForceNetUpdate();
}

void ATacBomb::Defuse()
{
	if (!HasAuthority() || State != ETacBombState::Planted)
	{
		return;
	}
	State = ETacBombState::Defused;
	OnRep_State();
	ForceNetUpdate();
}

void ATacBomb::Explode()
{
	if (!HasAuthority() || State != ETacBombState::Planted)
	{
		return;
	}
	State = ETacBombState::Exploded;
	OnRep_State();

	UGameplayStatics::ApplyRadialDamageWithFalloff(this, 500.f, 0.f, GetActorLocation(), 500.f, 1750.f, 1.f,
		UDamageType::StaticClass(), TArray<AActor*>(), this, nullptr, ECC_Visibility);

	MulticastExplode();
	ForceNetUpdate();
}

void ATacBomb::OnRep_State()
{
	if (State == ETacBombState::Planted)
	{
		PlantedLocalTime = GetWorld()->GetTimeSeconds();
		NextBeepTime = 0.f;
	}
	RefreshVisibility();
}

void ATacBomb::RefreshVisibility()
{
	Mesh->SetVisibility(State == ETacBombState::Dropped || State == ETacBombState::Planted || State == ETacBombState::Defused);
}

void ATacBomb::MulticastExplode_Implementation()
{
	if (GetNetMode() == NM_DedicatedServer)
	{
		return;
	}
	if (ExplosionEffect)
	{
		UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, ExplosionEffect, GetActorLocation());
	}
	if (ExplosionSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, GetActorLocation());
	}
}
