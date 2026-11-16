#include "TacCharacter.h"
#include "TacBomb.h"
#include "TacCharacterMovementComponent.h"
#include "TacGameMode.h"
#include "TacGameState.h"
#include "TacGrenade.h"
#include "TacLagCompensationComponent.h"
#include "TacPlayerController.h"
#include "TacPlayerState.h"
#include "TacWeaponData.h"

#include "Animation/AnimInstance.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/DamageEvents.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Net/UnrealNetwork.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "PhysicalMaterials/PhysicalMaterial.h"
#include "Sound/SoundBase.h"

namespace
{
	const FName MuzzleSocketName(TEXT("Muzzle"));
	const FName WeaponHandSocketName(TEXT("hand_r"));
	const FName TracerEndParameter(TEXT("TracerEnd"));

	int32 SlotIndex(ETacWeaponSlot Slot)
	{
		return Slot == ETacWeaponSlot::Primary ? 0 : 1;
	}
}

ATacCharacter::ATacCharacter(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer.SetDefaultSubobjectClass<UTacCharacterMovementComponent>(ACharacter::CharacterMovementComponentName))
{
	PrimaryActorTick.bCanEverTick = true;
	NetUpdateFrequency = 60.f;
	MinNetUpdateFrequency = 20.f;

	GetCapsuleComponent()->InitCapsuleSize(34.f, 90.f);
	BaseEyeHeight = 74.f;
	CrouchedEyeHeight = 48.f;
	StandingEyeHeight = BaseEyeHeight;

	bUseControllerRotationYaw = true;
	bUseControllerRotationPitch = false;
	bUseControllerRotationRoll = false;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(GetCapsuleComponent());
	Camera->SetRelativeLocation(FVector(0.f, 0.f, BaseEyeHeight));
	Camera->bUsePawnControlRotation = false; // the view is control rotation plus recoil, set in UpdateCamera
	Camera->SetFieldOfView(DefaultFieldOfView);

	ArmsMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("ArmsMesh"));
	ArmsMesh->SetupAttachment(Camera);
	ArmsMesh->SetOnlyOwnerSee(true);
	ArmsMesh->SetCastShadow(false);
	ArmsMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	FirstPersonWeaponMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("FirstPersonWeaponMesh"));
	FirstPersonWeaponMesh->SetupAttachment(ArmsMesh, WeaponHandSocketName);
	FirstPersonWeaponMesh->SetOnlyOwnerSee(true);
	FirstPersonWeaponMesh->SetCastShadow(false);
	FirstPersonWeaponMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// Third-person body. Hit detection uses analytic hitboxes, so the skeleton only has to
	// animate when it is actually drawn - never on a dedicated server.
	GetMesh()->SetOwnerNoSee(true);
	GetMesh()->SetRelativeLocation(FVector(0.f, 0.f, -90.f));
	GetMesh()->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));
	GetMesh()->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::OnlyTickPoseWhenRendered;
	GetMesh()->bEnableUpdateRateOptimizations = true;

	ThirdPersonWeaponMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("ThirdPersonWeaponMesh"));
	ThirdPersonWeaponMesh->SetupAttachment(GetMesh(), WeaponHandSocketName);
	ThirdPersonWeaponMesh->SetOwnerNoSee(true);
	ThirdPersonWeaponMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	LagCompensation = CreateDefaultSubobject<UTacLagCompensationComponent>(TEXT("LagCompensation"));
}

void ATacCharacter::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(ATacCharacter, Health);
	DOREPLIFETIME(ATacCharacter, Inventory);
	DOREPLIFETIME(ATacCharacter, ActiveSlot);
	DOREPLIFETIME(ATacCharacter, SelectedGrenade);
	DOREPLIFETIME(ATacCharacter, bIsReloading);
	DOREPLIFETIME(ATacCharacter, bIsDead);
	DOREPLIFETIME(ATacCharacter, Team);
	DOREPLIFETIME(ATacCharacter, bActionLocked);
	DOREPLIFETIME_CONDITION(ATacCharacter, UseProgress, COND_OwnerOnly);
}

void ATacCharacter::BeginPlay()
{
	Super::BeginPlay();
	SpawnLocalTime = GetWorld()->GetTimeSeconds();
	RefreshWeaponVisuals();
}

void ATacCharacter::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	// A carrier who leaves the game drops the bomb where they stood.
	if (HasAuthority() && EndPlayReason == EEndPlayReason::Destroyed)
	{
		const ATacGameState* GameState = GetWorld() ? GetWorld()->GetGameState<ATacGameState>() : nullptr;
		if (GameState && IsValid(GameState->Bomb) && GameState->Bomb->Carrier.Get() == this)
		{
			GameState->Bomb->Drop(GetFeetLocation());
		}
	}
	Super::EndPlay(EndPlayReason);
}

void ATacCharacter::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);
	if (const ATacPlayerState* TacPlayerState = NewController ? NewController->GetPlayerState<ATacPlayerState>() : nullptr)
	{
		Team = TacPlayerState->Team;
	}
}

void ATacCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const bool bLocal = IsLocallyControlled();
	const float Now = GetWorld()->GetTimeSeconds();

	if (bLocal || HasAuthority())
	{
		UpdateRecoil(DeltaSeconds);
	}

	if (bLocal && IsAlive() && bWantsToFire)
	{
		TryFire();
	}

	if (HasAuthority())
	{
		if (bIsReloading && Now >= ReloadEndTime)
		{
			FinishReload();
		}
		ServerTickUse(DeltaSeconds);
	}
	else if (bLocal && bIsReloading && Now > ReloadEndTime + 0.75f)
	{
		// The reload was predicted locally but never confirmed; give control back.
		bIsReloading = false;
	}

	if (GetNetMode() != NM_DedicatedServer)
	{
		UpdateCamera(DeltaSeconds);
		UpdateFootsteps(DeltaSeconds);
	}
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

UTacCharacterMovementComponent* ATacCharacter::GetTacMovement() const
{
	return Cast<UTacCharacterMovementComponent>(GetCharacterMovement());
}

bool ATacCharacter::IsADS() const
{
	const UTacCharacterMovementComponent* Movement = GetTacMovement();
	return Movement && Movement->bWantsADS;
}

bool ATacCharacter::IsMovementLocked() const
{
	if (bIsDead || bActionLocked)
	{
		return true;
	}
	const ATacGameState* GameState = GetWorld() ? GetWorld()->GetGameState<ATacGameState>() : nullptr;
	return GameState && GameState->IsFreezeTime();
}

FVector ATacCharacter::GetFeetLocation() const
{
	return GetActorLocation() - FVector(0.f, 0.f, GetCapsuleComponent()->GetScaledCapsuleHalfHeight());
}

const UTacWeaponData* ATacCharacter::GetWeaponInSlot(ETacWeaponSlot Slot) const
{
	if (Slot == ETacWeaponSlot::Grenade)
	{
		return nullptr;
	}
	const UTacWeaponCatalog* Catalog = UTacWeaponCatalog::Get(this);
	return Catalog ? Catalog->FindWeapon(Slot == ETacWeaponSlot::Primary ? Inventory.PrimaryId : Inventory.SecondaryId) : nullptr;
}

const UTacWeaponData* ATacCharacter::GetActiveWeapon() const
{
	return GetWeaponInSlot(ActiveSlot);
}

int32 ATacCharacter::GetMagAmmo() const
{
	return ActiveSlot == ETacWeaponSlot::Grenade ? Inventory.GetGrenadeCount(SelectedGrenade) : MagAmmo[SlotIndex(ActiveSlot)];
}

int32 ATacCharacter::GetReserveAmmo() const
{
	return ActiveSlot == ETacWeaponSlot::Grenade ? 0 : ReserveAmmo[SlotIndex(ActiveSlot)];
}

float ATacCharacter::GetWeaponSpeedMultiplier(bool bAiming) const
{
	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (!Weapon)
	{
		return 0.96f;
	}
	return Weapon->MoveSpeedMultiplier * (bAiming ? Weapon->ADSMoveSpeedMultiplier : 1.f);
}

float ATacCharacter::GetCurrentSpreadDegrees() const
{
	const UTacWeaponData* Weapon = GetActiveWeapon();
	const UTacCharacterMovementComponent* Movement = GetTacMovement();
	if (!Weapon || !Movement)
	{
		return 0.f;
	}

	float Spread = bIsCrouched ? Weapon->SpreadCrouching : Weapon->SpreadStanding;
	if (IsADS())
	{
		Spread *= Weapon->SpreadADSMultiplier;
	}

	// Full accuracy up to walking speed; the penalty grows from there to a full run.
	const float Speed = GetVelocity().Size2D();
	const float AccurateSpeed = Movement->WalkSpeed;
	const float MoveAlpha = FMath::Clamp((Speed - AccurateSpeed) / FMath::Max(Movement->RunSpeed - AccurateSpeed, 1.f), 0.f, 1.f);
	Spread += Weapon->SpreadMovingAdd * MoveAlpha;

	if (Movement->IsFalling())
	{
		Spread += Weapon->SpreadAirborneAdd;
	}
	return Spread;
}

bool ATacCharacter::CanStartPlant() const
{
	const ATacGameState* GameState = GetWorld() ? GetWorld()->GetGameState<ATacGameState>() : nullptr;
	if (!IsAlive() || Team != ETacTeam::Attackers || !GameState || GameState->Phase != ETacRoundPhase::Live)
	{
		return false;
	}
	const ATacBomb* Bomb = GameState->Bomb;
	if (!IsValid(Bomb) || Bomb->State != ETacBombState::Carried || Bomb->Carrier.Get() != this)
	{
		return false;
	}
	if (!GetCharacterMovement()->IsMovingOnGround())
	{
		return false;
	}
	return ATacBombSite::FindSiteAt(GetWorld(), GetFeetLocation() + FVector(0.f, 0.f, 20.f)) != nullptr;
}

bool ATacCharacter::CanStartDefuse() const
{
	const ATacGameState* GameState = GetWorld() ? GetWorld()->GetGameState<ATacGameState>() : nullptr;
	if (!IsAlive() || Team != ETacTeam::Defenders || !GameState || GameState->Phase != ETacRoundPhase::BombPlanted)
	{
		return false;
	}
	const ATacBomb* Bomb = GameState->Bomb;
	return IsValid(Bomb) && Bomb->State == ETacBombState::Planted
		&& FVector::DistSquared(Bomb->GetActorLocation(), GetFeetLocation()) <= FMath::Square(DefuseRange);
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

void ATacCharacter::StartFire()
{
	bWantsToFire = true;
	bFiredSincePress = false;
}

void ATacCharacter::StopFire()
{
	bWantsToFire = false;
}

void ATacCharacter::SetADS(bool bAiming)
{
	if (UTacCharacterMovementComponent* Movement = GetTacMovement())
	{
		Movement->bWantsADS = bAiming && IsAlive() && GetActiveWeapon() != nullptr;
	}
}

void ATacCharacter::SetWalking(bool bWalking)
{
	if (UTacCharacterMovementComponent* Movement = GetTacMovement())
	{
		Movement->bWantsToWalk = bWalking;
	}
}

void ATacCharacter::SelectSlot(ETacWeaponSlot Slot)
{
	RequestSlot(Slot, SelectedGrenade);
}

void ATacCharacter::SelectGrenade(ETacGrenadeType Type)
{
	RequestSlot(ETacWeaponSlot::Grenade, Type);
}

void ATacCharacter::SwapWeapon()
{
	ETacWeaponSlot Target = ActiveSlot == ETacWeaponSlot::Primary ? ETacWeaponSlot::Secondary : ETacWeaponSlot::Primary;
	if (!GetWeaponInSlot(Target))
	{
		Target = ETacWeaponSlot::Secondary;
	}
	RequestSlot(Target, SelectedGrenade);
}

void ATacCharacter::SetUseHeld(bool bHeld)
{
	if (HasAuthority())
	{
		bUseHeld = bHeld;
	}
	else
	{
		ServerSetUseHeld(bHeld);
	}
}

void ATacCharacter::ServerSetUseHeld_Implementation(bool bHeld)
{
	bUseHeld = bHeld;
}

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------

void ATacCharacter::InitFromLoadout(const FTacLoadout& Loadout)
{
	Inventory = Loadout;
	Health = 100.f;

	for (ETacWeaponSlot Slot : { ETacWeaponSlot::Primary, ETacWeaponSlot::Secondary })
	{
		const UTacWeaponData* Weapon = GetWeaponInSlot(Slot);
		MagAmmo[SlotIndex(Slot)] = Weapon ? Weapon->MagazineSize : 0;
		ReserveAmmo[SlotIndex(Slot)] = Weapon ? Weapon->ReserveAmmo : 0;
		SyncAmmoToOwner(Slot);
	}

	ActiveSlot = Inventory.PrimaryId.IsNone() ? ETacWeaponSlot::Secondary : ETacWeaponSlot::Primary;
	RefreshWeaponVisuals();
}

void ATacCharacter::GiveWeapon(const UTacWeaponData* Weapon)
{
	if (!HasAuthority() || !Weapon || Weapon->Slot == ETacWeaponSlot::Grenade)
	{
		return;
	}
	if (Weapon->Slot == ETacWeaponSlot::Primary)
	{
		Inventory.PrimaryId = Weapon->WeaponId;
	}
	else
	{
		Inventory.SecondaryId = Weapon->WeaponId;
	}
	MagAmmo[SlotIndex(Weapon->Slot)] = Weapon->MagazineSize;
	ReserveAmmo[SlotIndex(Weapon->Slot)] = Weapon->ReserveAmmo;
	SyncAmmoToOwner(Weapon->Slot);
	ApplySlot(Weapon->Slot, SelectedGrenade);
}

void ATacCharacter::GiveArmor(bool bWithHelmet)
{
	if (HasAuthority())
	{
		Inventory.Armor = 100;
		Inventory.bHelmet = Inventory.bHelmet || bWithHelmet;
	}
}

void ATacCharacter::AddGrenade(ETacGrenadeType Type)
{
	if (HasAuthority())
	{
		++Inventory.GrenadeCount(Type);
	}
}

void ATacCharacter::GiveDefuseKit()
{
	if (HasAuthority())
	{
		Inventory.bDefuseKit = true;
	}
}

void ATacCharacter::SyncAmmoToOwner(ETacWeaponSlot Slot)
{
	if (HasAuthority() && !IsLocallyControlled() && GetController())
	{
		ClientSetAmmo(static_cast<uint8>(SlotIndex(Slot)), MagAmmo[SlotIndex(Slot)], ReserveAmmo[SlotIndex(Slot)]);
	}
}

void ATacCharacter::ClientSetAmmo_Implementation(uint8 Slot, int32 Mag, int32 Reserve)
{
	if (Slot < 2)
	{
		MagAmmo[Slot] = Mag;
		ReserveAmmo[Slot] = Reserve;
	}
}

bool ATacCharacter::CanUseSlot(ETacWeaponSlot Slot, ETacGrenadeType Grenade) const
{
	if (!IsAlive() || bActionLocked)
	{
		return false;
	}
	if (Slot == ETacWeaponSlot::Grenade)
	{
		return Inventory.GetGrenadeCount(Grenade) > 0;
	}
	return GetWeaponInSlot(Slot) != nullptr;
}

void ATacCharacter::RequestSlot(ETacWeaponSlot Slot, ETacGrenadeType Grenade)
{
	if ((Slot == ActiveSlot && Grenade == SelectedGrenade) || !CanUseSlot(Slot, Grenade))
	{
		return;
	}
	ApplySlot(Slot, Grenade); // predicted on the owner
	if (!HasAuthority())
	{
		ServerSelectSlot(Slot, Grenade);
	}
}

void ATacCharacter::ServerSelectSlot_Implementation(ETacWeaponSlot Slot, ETacGrenadeType Grenade)
{
	if (CanUseSlot(Slot, Grenade))
	{
		ApplySlot(Slot, Grenade);
	}
}

void ATacCharacter::ApplySlot(ETacWeaponSlot Slot, ETacGrenadeType Grenade)
{
	const float Now = GetWorld()->GetTimeSeconds();
	ActiveSlot = Slot;
	SelectedGrenade = Grenade;
	bIsReloading = false;
	SprayIndex = 0.f;
	NextFireTime = Now + EquipTime;
	FireBlockedUntil = Now + EquipTime * 0.8f;
	ShotCredit = 1.f;
	LastCreditTime = Now;
	if (IsLocallyControlled())
	{
		SetADS(false);
	}
	RefreshWeaponVisuals();
}

void ATacCharacter::RefreshWeaponVisuals()
{
	if (GetNetMode() == NM_DedicatedServer)
	{
		return;
	}
	const UTacWeaponData* Weapon = GetActiveWeapon();
	USkeletalMesh* WeaponMesh = Weapon ? Weapon->Mesh.LoadSynchronous() : nullptr;
	FirstPersonWeaponMesh->SetSkeletalMesh(WeaponMesh);
	ThirdPersonWeaponMesh->SetSkeletalMesh(WeaponMesh);
}

void ATacCharacter::OnRep_Loadout()
{
	RefreshWeaponVisuals();
}

// ---------------------------------------------------------------------------------------------
// Reload
// ---------------------------------------------------------------------------------------------

bool ATacCharacter::CanReload() const
{
	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (!IsAlive() || !Weapon || bIsReloading || bActionLocked)
	{
		return false;
	}
	const int32 Slot = SlotIndex(ActiveSlot);
	return MagAmmo[Slot] < Weapon->MagazineSize && ReserveAmmo[Slot] > 0;
}

void ATacCharacter::StartReload()
{
	if (!CanReload())
	{
		return;
	}
	if (!HasAuthority())
	{
		// Predict, so the gun stops firing immediately instead of one round-trip later.
		bIsReloading = true;
		ReloadEndTime = GetWorld()->GetTimeSeconds() + GetActiveWeapon()->ReloadTime;
		OnRep_Reloading();
	}
	SetADS(false);
	ServerReload();
}

void ATacCharacter::ServerReload_Implementation()
{
	if (!CanReload())
	{
		// The owner may have predicted a reload the server does not agree with.
		SyncAmmoToOwner(ActiveSlot);
		return;
	}
	bIsReloading = true;
	ReloadEndTime = GetWorld()->GetTimeSeconds() + GetActiveWeapon()->ReloadTime;
	OnRep_Reloading();
}

void ATacCharacter::FinishReload()
{
	bIsReloading = false;
	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (!Weapon)
	{
		return;
	}
	const int32 Slot = SlotIndex(ActiveSlot);
	const int32 Moved = FMath::Min(Weapon->MagazineSize - MagAmmo[Slot], ReserveAmmo[Slot]);
	MagAmmo[Slot] += Moved;
	ReserveAmmo[Slot] -= Moved;
	SprayIndex = 0.f;
	SyncAmmoToOwner(ActiveSlot);
}

void ATacCharacter::OnRep_Reloading()
{
	if (!bIsReloading || GetNetMode() == NM_DedicatedServer)
	{
		return;
	}
	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (Weapon && Weapon->ReloadMontage)
	{
		if (IsLocallyControlled())
		{
			if (UAnimInstance* ArmsAnim = ArmsMesh->GetAnimInstance())
			{
				ArmsAnim->Montage_Play(Weapon->ReloadMontage);
			}
		}
		else
		{
			PlayAnimMontage(Weapon->ReloadMontage);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------------------------

void ATacCharacter::TryFire()
{
	const ATacGameState* GameState = GetWorld()->GetGameState<ATacGameState>();
	if (!GameState || !GameState->IsCombatAllowed() || bActionLocked)
	{
		return;
	}

	const float Now = GetWorld()->GetTimeSeconds();
	if (Now < NextFireTime)
	{
		return;
	}

	if (ActiveSlot == ETacWeaponSlot::Grenade)
	{
		if (!bFiredSincePress && Inventory.GetGrenadeCount(SelectedGrenade) > 0)
		{
			bFiredSincePress = true;
			NextFireTime = Now + EquipTime;
			ServerThrowGrenade(GetControlRotation().Vector());
		}
		return;
	}

	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (!Weapon || bIsReloading || (!Weapon->bAutomatic && bFiredSincePress))
	{
		return;
	}

	if (MagAmmo[SlotIndex(ActiveSlot)] <= 0)
	{
		StartReload();
		return;
	}

	bFiredSincePress = true;

	// Keep the cadence exact instead of rounding every shot up to the next frame.
	const float Interval = Weapon->GetFireInterval();
	NextFireTime = (Now - NextFireTime < 0.05f) ? NextFireTime + Interval : Now + Interval;

	const FVector Origin = Camera->GetComponentLocation();
	const FVector AimDirection = GetControlRotation().Vector();

	if (HasAuthority())
	{
		ProcessShot(Origin, AimDirection);
	}
	else
	{
		PredictShot(Weapon, Origin, AimDirection);
		ServerFire(Origin, AimDirection);
	}
}

FVector2D ATacCharacter::ConsumeRecoilShot(const UTacWeaponData* Weapon)
{
	const int32 Shot = FMath::FloorToInt(SprayIndex);
	SprayIndex = Shot + 1.f;
	LastShotTime = GetWorld()->GetTimeSeconds();
	return Weapon->GetRecoilOffset(Shot);
}

FVector ATacCharacter::BuildShotDirection(const FVector& AimDirection, const FVector2D& RecoilOffset, float SpreadDegrees) const
{
	FRotator Rotation = AimDirection.Rotation();
	Rotation.Yaw += RecoilOffset.X;
	Rotation.Pitch = FMath::Clamp<double>(Rotation.Pitch + RecoilOffset.Y, -89.9, 89.9);
	const FVector Direction = Rotation.Vector();
	return SpreadDegrees > KINDA_SMALL_NUMBER ? FMath::VRandCone(Direction, FMath::DegreesToRadians(SpreadDegrees)) : Direction;
}

void ATacCharacter::PredictShot(const UTacWeaponData* Weapon, const FVector& Origin, const FVector& AimDirection)
{
	// Cosmetic only: the server decides what was hit. This gives instant ammo, recoil and tracer feedback.
	--MagAmmo[SlotIndex(ActiveSlot)];

	const float Spread = GetCurrentSpreadDegrees();
	const FVector Direction = BuildShotDirection(AimDirection, ConsumeRecoilShot(Weapon), Spread);
	const FVector TraceEnd = Origin + Direction * Weapon->Range;

	FCollisionQueryParams Params(SCENE_QUERY_STAT(TacBulletPredict), true, this);
	Params.bReturnPhysicalMaterial = true;
	for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
	{
		Params.AddIgnoredActor(*It);
	}

	FHitResult Hit;
	const bool bHit = GetWorld()->LineTraceSingleByChannel(Hit, Origin, TraceEnd, ECC_Visibility, Params);
	const uint8 Surface = bHit ? static_cast<uint8>(UPhysicalMaterial::DetermineSurfaceType(Hit.PhysMaterial.Get())) : 0;
	PlayFireFX(bHit ? FVector(Hit.ImpactPoint) : TraceEnd, Surface, bHit);
}

void ATacCharacter::ServerFire_Implementation(const FVector_NetQuantize& Origin, const FVector_NetQuantizeNormal& AimDirection)
{
	ProcessShot(Origin, AimDirection);
}

float ATacCharacter::GetRewindSeconds() const
{
	// The shooter saw the world one trip behind the server plus the smoothing delay, and the
	// shot took one trip to arrive. The server measures this itself rather than trusting a
	// timestamp from the client, and never rewinds further than MaxRewindSeconds.
	const APlayerState* ShooterState = GetPlayerState();
	if (!ShooterState || IsLocallyControlled())
	{
		return 0.f;
	}
	return FMath::Clamp(ShooterState->GetPingInMilliseconds() * 0.001f + InterpolationDelay, 0.f, MaxRewindSeconds);
}

void ATacCharacter::ProcessShot(const FVector& ClientOrigin, const FVector& AimDirection)
{
	UWorld* World = GetWorld();
	const ATacGameState* GameState = World->GetGameState<ATacGameState>();
	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (!IsAlive() || !GameState || !GameState->IsCombatAllowed() || !Weapon || bIsReloading || bActionLocked)
	{
		return;
	}

	const int32 Slot = SlotIndex(ActiveSlot);
	const float Now = World->GetTimeSeconds();

	// Fire-rate check. Shots can arrive bunched together, so allow a short burst but not a faster average.
	ShotCredit = FMath::Min(2.f, ShotCredit + (Now - LastCreditTime) / Weapon->GetFireInterval());
	LastCreditTime = Now;
	if (MagAmmo[Slot] <= 0 || ShotCredit < 1.f || Now < FireBlockedUntil)
	{
		SyncAmmoToOwner(ActiveSlot);
		return;
	}
	ShotCredit -= 1.f;
	--MagAmmo[Slot];

	const FVector Aim = AimDirection.GetSafeNormal();
	if (Aim.IsNearlyZero())
	{
		return;
	}

	// The shot must start near where the server has the shooter's eyes.
	const float Rewind = GetRewindSeconds();
	const FVector ServerEye = GetPawnViewLocation();
	const float OriginTolerance = 120.f + GetVelocity().Size() * (Rewind + 0.1f);
	const FVector Origin = FVector::DistSquared(ClientOrigin, ServerEye) <= FMath::Square(OriginTolerance) ? ClientOrigin : ServerEye;

	// Recoil and spread are applied here, from the server's own spray counter and movement
	// state. The client only says where it was aiming, so it cannot remove either.
	const float Spread = GetCurrentSpreadDegrees();
	const FVector Direction = BuildShotDirection(Aim, ConsumeRecoilShot(Weapon), Spread);
	const FVector TraceEnd = Origin + Direction * Weapon->Range;

	// 1. World geometry at present time.
	FCollisionQueryParams Params(SCENE_QUERY_STAT(TacBullet), true, this);
	Params.bReturnPhysicalMaterial = true;
	for (TActorIterator<ATacCharacter> It(World); It; ++It)
	{
		Params.AddIgnoredActor(*It);
	}
	FHitResult WorldHit;
	const bool bWorldHit = World->LineTraceSingleByChannel(WorldHit, Origin, TraceEnd, ECC_Visibility, Params);
	const float WorldDistance = bWorldHit ? WorldHit.Distance : Weapon->Range;

	// 2. Enemies where they were when the shooter fired.
	const float HitTime = Now - Rewind;
	ATacCharacter* Victim = nullptr;
	ETacHitZone VictimZone = ETacHitZone::None;
	float VictimDistance = WorldDistance;
	for (TActorIterator<ATacCharacter> It(World); It; ++It)
	{
		ATacCharacter* Other = *It;
		if (Other == this || !Other->IsAlive() || Other->GetTeam() == Team)
		{
			continue;
		}
		float Distance = 0.f;
		const ETacHitZone Zone = Other->LagCompensation->TestRay(HitTime, Origin, Direction, VictimDistance, Distance);
		if (Zone != ETacHitZone::None && Distance < VictimDistance)
		{
			Victim = Other;
			VictimZone = Zone;
			VictimDistance = Distance;
		}
	}

	// 3. Damage.
	if (Victim)
	{
		float Multiplier = 1.f;
		switch (VictimZone)
		{
		case ETacHitZone::Head: Multiplier = Weapon->HeadMultiplier; break;
		case ETacHitZone::Stomach: Multiplier = Weapon->StomachMultiplier; break;
		case ETacHitZone::Legs: Multiplier = Weapon->LegMultiplier; break;
		default: break;
		}
		const float Falloff = FMath::Pow(Weapon->RangeModifier, VictimDistance / 1000.f);
		const bool bHeadshot = VictimZone == ETacHitZone::Head;
		Victim->ApplyDamageInternal(Weapon->BaseDamage * Multiplier * Falloff, Weapon->ArmorPenetration, bHeadshot, GetController(), Weapon->WeaponId);

		if (ATacPlayerController* ShooterController = Cast<ATacPlayerController>(GetController()))
		{
			ShooterController->ClientHitConfirm(bHeadshot, !Victim->IsAlive());
		}
	}

	// 4. Effects for everyone else (the shooter already drew a predicted version).
	const bool bImpact = Victim != nullptr || bWorldHit;
	const FVector End = Victim ? Origin + Direction * VictimDistance : (bWorldHit ? FVector(WorldHit.ImpactPoint) : TraceEnd);
	const uint8 Surface = Victim ? TacSurfaceFlesh
		: (bWorldHit ? static_cast<uint8>(UPhysicalMaterial::DetermineSurfaceType(WorldHit.PhysMaterial.Get())) : 0);

	if (IsLocallyControlled())
	{
		PlayFireFX(End, Surface, bImpact); // listen-server host
	}
	MulticastFireFX(End, Surface, bImpact);
}

void ATacCharacter::MulticastFireFX_Implementation(const FVector_NetQuantize& End, uint8 Surface, bool bImpact)
{
	if (!IsLocallyControlled())
	{
		PlayFireFX(End, Surface, bImpact);
	}
}

FVector ATacCharacter::GetMuzzleLocation() const
{
	const USkeletalMeshComponent* WeaponMesh = IsLocallyControlled() ? FirstPersonWeaponMesh : ThirdPersonWeaponMesh;
	if (WeaponMesh->GetSkeletalMeshAsset() && WeaponMesh->DoesSocketExist(MuzzleSocketName))
	{
		return WeaponMesh->GetSocketLocation(MuzzleSocketName);
	}
	if (IsLocallyControlled())
	{
		return Camera->GetComponentLocation() + Camera->GetForwardVector() * 60.f + Camera->GetRightVector() * 12.f - Camera->GetUpVector() * 10.f;
	}
	return GetPawnViewLocation() + GetActorForwardVector() * 60.f;
}

void ATacCharacter::PlayFireFX(const FVector& End, uint8 Surface, bool bImpact)
{
	if (GetNetMode() == NM_DedicatedServer)
	{
		return;
	}

	MarkRevealed(); // gunfire shows on the minimap

	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (!Weapon)
	{
		return;
	}

	const FVector Muzzle = GetMuzzleLocation();
	const FRotator ShotRotation = (End - Muzzle).Rotation();

	if (Weapon->MuzzleFlash)
	{
		UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, Weapon->MuzzleFlash, Muzzle, ShotRotation);
	}
	if (Weapon->Tracer)
	{
		if (UNiagaraComponent* TracerComponent = UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, Weapon->Tracer, Muzzle, ShotRotation))
		{
			TracerComponent->SetVectorParameter(TracerEndParameter, End);
		}
	}
	if (bImpact)
	{
		UNiagaraSystem* Impact = Weapon->DefaultImpactEffect;
		if (Surface == TacSurfaceFlesh)
		{
			Impact = Weapon->FleshImpactEffect;
		}
		else if (const TObjectPtr<UNiagaraSystem>* Found = Weapon->ImpactEffects.Find(TEnumAsByte<EPhysicalSurface>(static_cast<EPhysicalSurface>(Surface))))
		{
			Impact = Found->Get();
		}
		if (Impact)
		{
			UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, Impact, End, (Muzzle - End).Rotation());
		}
	}
	if (Weapon->FireSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, Weapon->FireSound, Muzzle);
	}
	if (Weapon->FireMontage && IsLocallyControlled())
	{
		if (UAnimInstance* ArmsAnim = ArmsMesh->GetAnimInstance())
		{
			ArmsAnim->Montage_Play(Weapon->FireMontage);
		}
	}
}

void ATacCharacter::UpdateRecoil(float DeltaSeconds)
{
	const UTacWeaponData* Weapon = GetActiveWeapon();
	if (!Weapon)
	{
		SprayIndex = 0.f;
		AimPunch = FMath::Vector2DInterpTo(AimPunch, FVector2D::ZeroVector, DeltaSeconds, 12.f);
		return;
	}

	// Once the trigger is released the spray walks back down the pattern.
	const float SinceShot = GetWorld()->GetTimeSeconds() - LastShotTime;
	if (SinceShot > Weapon->GetFireInterval() * 1.4f + 0.04f)
	{
		SprayIndex = FMath::Max(0.f, SprayIndex - Weapon->RecoilRecoveryRate * DeltaSeconds);
	}

	// The view follows the pattern, so the crosshair shows where the next bullet goes and the
	// player counters the spray by dragging against it.
	AimPunch = FMath::Vector2DInterpTo(AimPunch, Weapon->GetRecoilOffsetSmooth(SprayIndex), DeltaSeconds, 22.f);
}

// ---------------------------------------------------------------------------------------------
// Grenades
// ---------------------------------------------------------------------------------------------

void ATacCharacter::ServerThrowGrenade_Implementation(const FVector_NetQuantizeNormal& AimDirection)
{
	const ATacGameState* GameState = GetWorld()->GetGameState<ATacGameState>();
	if (!IsAlive() || bActionLocked || !GameState || !GameState->IsCombatAllowed() || ActiveSlot != ETacWeaponSlot::Grenade)
	{
		return;
	}
	uint8& Count = Inventory.GrenadeCount(SelectedGrenade);
	const FVector Direction = FVector(AimDirection).GetSafeNormal();
	if (Count == 0 || Direction.IsNearlyZero())
	{
		return;
	}
	--Count;

	FActorSpawnParameters SpawnParams;
	SpawnParams.Owner = this;
	SpawnParams.Instigator = this;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	UClass* ClassToSpawn = GrenadeClass ? GrenadeClass.Get() : ATacGrenade::StaticClass();
	const FVector SpawnLocation = GetPawnViewLocation() + Direction * 50.f;
	if (ATacGrenade* Grenade = GetWorld()->SpawnActor<ATacGrenade>(ClassToSpawn, SpawnLocation, Direction.Rotation(), SpawnParams))
	{
		Grenade->Launch(SelectedGrenade, Direction * 1500.f + FVector(0.f, 0.f, 220.f) + GetVelocity() * 0.6f);
	}

	// Back to a gun once it is thrown.
	ApplySlot(Inventory.PrimaryId.IsNone() ? ETacWeaponSlot::Secondary : ETacWeaponSlot::Primary, SelectedGrenade);
}

// ---------------------------------------------------------------------------------------------
// Plant / defuse
// ---------------------------------------------------------------------------------------------

void ATacCharacter::ServerTickUse(float DeltaSeconds)
{
	const bool bPlanting = bUseHeld && CanStartPlant();
	const bool bDefusing = bUseHeld && !bPlanting && CanStartDefuse();

	if (!bPlanting && !bDefusing)
	{
		bActionLocked = false;
		UseTime = 0.f;
		UseProgress = 0.f;
		return;
	}

	bActionLocked = true;
	UseTime += DeltaSeconds;
	const float Required = bPlanting ? PlantTime : (Inventory.bDefuseKit ? DefuseTimeWithKit : DefuseTime);
	UseProgress = FMath::Clamp(UseTime / Required, 0.f, 1.f);
	if (UseTime < Required)
	{
		return;
	}

	bUseHeld = false;
	bActionLocked = false;
	UseTime = 0.f;
	UseProgress = 0.f;

	ATacGameState* GameState = GetWorld()->GetGameState<ATacGameState>();
	ATacGameMode* GameMode = GetWorld()->GetAuthGameMode<ATacGameMode>();
	if (!GameState || !GameMode || !IsValid(GameState->Bomb))
	{
		return;
	}

	if (bPlanting)
	{
		const ATacBombSite* Site = ATacBombSite::FindSiteAt(GetWorld(), GetFeetLocation() + FVector(0.f, 0.f, 20.f));
		const FName SiteName = Site ? Site->SiteName : NAME_None;
		GameState->Bomb->Plant(this, SiteName);
		GameMode->NotifyBombPlanted(this, SiteName);
	}
	else
	{
		GameState->Bomb->Defuse();
		GameMode->NotifyBombDefused(this);
	}
}

// ---------------------------------------------------------------------------------------------
// Damage and death
// ---------------------------------------------------------------------------------------------

float ATacCharacter::TakeDamage(float DamageAmount, const FDamageEvent& DamageEvent, AController* EventInstigator, AActor* DamageCauser)
{
	// Explosions (HE grenades, the bomb) arrive here. Bullets go straight to ApplyDamageInternal.
	const float Actual = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);
	if (Actual <= 0.f || !IsAlive())
	{
		return 0.f;
	}

	// No team damage, but your own grenade can hurt you.
	if (EventInstigator && EventInstigator != GetController())
	{
		const ATacPlayerState* InstigatorState = EventInstigator->GetPlayerState<ATacPlayerState>();
		if (InstigatorState && InstigatorState->Team == Team)
		{
			return 0.f;
		}
	}

	const FName WeaponId = Cast<ATacBomb>(DamageCauser) ? TacItems::Bomb : TacItems::HE;
	ApplyDamageInternal(Actual, 0.6f, false, EventInstigator, WeaponId);
	return Actual;
}

void ATacCharacter::ApplyDamageInternal(float Damage, float ArmorPenetration, bool bHeadshot, AController* InstigatorController, FName WeaponId)
{
	const ATacGameState* GameState = GetWorld()->GetGameState<ATacGameState>();
	if (!HasAuthority() || !IsAlive() || Damage <= 0.f || !GameState || !GameState->IsCombatAllowed())
	{
		return;
	}

	// Armor soaks part of the hit and wears down. Head hits are only protected by a helmet.
	float HealthDamage = Damage;
	const bool bArmored = bHeadshot ? Inventory.bHelmet : Inventory.Armor > 0;
	if (bArmored)
	{
		HealthDamage = Damage * FMath::Clamp(ArmorPenetration, 0.f, 1.f);
		const int32 ArmorDamage = FMath::RoundToInt((Damage - HealthDamage) * 0.5f);
		Inventory.Armor = static_cast<uint8>(FMath::Max(0, static_cast<int32>(Inventory.Armor) - ArmorDamage));
		if (Inventory.Armor == 0)
		{
			Inventory.bHelmet = false;
		}
	}

	Health = FMath::Max(0.f, Health - HealthDamage);
	if (Health <= 0.f)
	{
		Die(InstigatorController, WeaponId, bHeadshot);
	}
}

void ATacCharacter::Die(AController* Killer, FName WeaponId, bool bHeadshot)
{
	if (bIsDead)
	{
		return;
	}
	bIsDead = true;
	bIsReloading = false;
	bActionLocked = false;
	bUseHeld = false;

	ATacGameState* GameState = GetWorld()->GetGameState<ATacGameState>();
	if (GameState && IsValid(GameState->Bomb) && GameState->Bomb->Carrier.Get() == this)
	{
		GameState->Bomb->Drop(GetFeetLocation());
	}

	AController* VictimController = GetController();
	OnRep_IsDead();

	if (ATacGameMode* GameMode = GetWorld()->GetAuthGameMode<ATacGameMode>())
	{
		GameMode->NotifyCharacterKilled(this, VictimController, Killer, WeaponId, bHeadshot);
	}
}

void ATacCharacter::OnRep_IsDead()
{
	if (!bIsDead)
	{
		return;
	}
	bWantsToFire = false;
	GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	GetCharacterMovement()->DisableMovement();
	ArmsMesh->SetVisibility(false, true);

	if (GetNetMode() != NM_DedicatedServer && GetMesh()->GetPhysicsAsset())
	{
		GetMesh()->SetOwnerNoSee(false);
		GetMesh()->SetCollisionProfileName(TEXT("Ragdoll"));
		GetMesh()->SetSimulatePhysics(true);
	}
}

// ---------------------------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------------------------

void ATacCharacter::OnStartCrouch(float HalfHeightAdjust, float ScaledHalfHeightAdjust)
{
	Super::OnStartCrouch(HalfHeightAdjust, ScaledHalfHeightAdjust);
	// The capsule snaps down; keep the eye where it was and let UpdateCamera ease it.
	CrouchCameraOffset += ScaledHalfHeightAdjust + (StandingEyeHeight - CrouchedEyeHeight);
}

void ATacCharacter::OnEndCrouch(float HalfHeightAdjust, float ScaledHalfHeightAdjust)
{
	Super::OnEndCrouch(HalfHeightAdjust, ScaledHalfHeightAdjust);
	CrouchCameraOffset -= ScaledHalfHeightAdjust + (StandingEyeHeight - CrouchedEyeHeight);
}

void ATacCharacter::UpdateCamera(float DeltaSeconds)
{
	CrouchCameraOffset = FMath::FInterpTo(CrouchCameraOffset, 0.f, DeltaSeconds, 12.f);
	Camera->SetRelativeLocation(FVector(0.f, 0.f, BaseEyeHeight + CrouchCameraOffset));

	// Remote characters (spectating) use the replicated view pitch.
	const float BasePitch = FRotator::NormalizeAxis(IsLocallyControlled() ? GetControlRotation().Pitch : GetBaseAimRotation().Pitch);
	const float ViewPitch = FMath::Clamp(BasePitch + static_cast<float>(AimPunch.Y), -89.f, 89.f);
	Camera->SetRelativeRotation(FRotator(ViewPitch, AimPunch.X, 0.f));

	const UTacWeaponData* Weapon = GetActiveWeapon();
	const float TargetFOV = (Weapon && IsADS()) ? Weapon->ADSFieldOfView : DefaultFieldOfView;
	Camera->SetFieldOfView(FMath::FInterpTo(Camera->FieldOfView, TargetFOV, DeltaSeconds, 14.f));
}

void ATacCharacter::UpdateFootsteps(float DeltaSeconds)
{
	const UTacCharacterMovementComponent* Movement = GetTacMovement();
	const float Speed = GetVelocity().Size2D();

	// Running is audible. Walking and crouching are silent.
	const bool bAudible = IsAlive() && Movement && Movement->IsMovingOnGround() && !bIsCrouched && Speed > Movement->WalkSpeed * 1.15f;
	if (!bAudible)
	{
		StepDistance = 0.f;
		return;
	}

	StepDistance += Speed * DeltaSeconds;
	if (StepDistance < FootstepStride)
	{
		return;
	}
	StepDistance = 0.f;

	if (FootstepSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, FootstepSound, GetFeetLocation());
	}

	// Footsteps the local player can hear ping the minimap.
	if (const APlayerController* LocalController = GetWorld()->GetFirstPlayerController())
	{
		FVector ViewLocation;
		FRotator ViewRotation;
		LocalController->GetPlayerViewPoint(ViewLocation, ViewRotation);
		if (FVector::DistSquared(ViewLocation, GetActorLocation()) < FMath::Square(FootstepHearingRadius))
		{
			MarkRevealed();
		}
	}
}

void ATacCharacter::MarkRevealed()
{
	LastRevealTime = GetWorld()->GetTimeSeconds();
	LastRevealLocation = GetActorLocation();
}
