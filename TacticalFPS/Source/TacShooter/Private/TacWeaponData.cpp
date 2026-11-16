#include "TacWeaponData.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"

FVector2D UTacWeaponData::GetRecoilOffset(int32 ShotIndex) const
{
	if (RecoilPattern.Num() == 0)
	{
		return FVector2D::ZeroVector;
	}
	return RecoilPattern[FMath::Clamp(ShotIndex, 0, RecoilPattern.Num() - 1)];
}

FVector2D UTacWeaponData::GetRecoilOffsetSmooth(float ShotIndex) const
{
	const int32 Low = FMath::FloorToInt(ShotIndex);
	const float Alpha = ShotIndex - Low;
	return FMath::Lerp(GetRecoilOffset(Low), GetRecoilOffset(Low + 1), Alpha);
}

void UTacWeaponData::GenerateRecoilPattern(int32 Shots, float ClimbDegrees, float SwayDegrees, float SwayFrequency, float DriftDegrees)
{
	RecoilPattern.Reset(Shots);
	for (int32 Index = 0; Index < Shots; ++Index)
	{
		const float Shot = static_cast<float>(Index);
		const float Pitch = ClimbDegrees * (1.f - FMath::Exp(-Shot / 7.f));
		const float SwayGate = FMath::SmoothStep(4.f, 10.f, Shot);
		const float Yaw = SwayGate * SwayDegrees * FMath::Sin((Shot - 4.f) * SwayFrequency)
			+ DriftDegrees * (1.f - FMath::Exp(-Shot / 10.f));
		RecoilPattern.Add(FVector2D(Yaw, Pitch));
	}
	if (RecoilPattern.Num() > 0)
	{
		RecoilPattern[0] = FVector2D::ZeroVector;
	}
}

void UTacWeaponCatalog::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	BuildDefaultArsenal();
}

UTacWeaponCatalog* UTacWeaponCatalog::Get(const UObject* WorldContextObject)
{
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
	return GameInstance ? GameInstance->GetSubsystem<UTacWeaponCatalog>() : nullptr;
}

const UTacWeaponData* UTacWeaponCatalog::FindWeapon(FName WeaponId) const
{
	if (WeaponId.IsNone())
	{
		return nullptr;
	}
	for (const UTacWeaponData* Weapon : Weapons)
	{
		if (Weapon && Weapon->WeaponId == WeaponId)
		{
			return Weapon;
		}
	}
	return nullptr;
}

const FTacBuyItem* UTacWeaponCatalog::FindBuyItem(FName ItemId) const
{
	return BuyItems.FindByPredicate([ItemId](const FTacBuyItem& Item) { return Item.Id == ItemId; });
}

void UTacWeaponCatalog::RegisterWeapon(UTacWeaponData* Weapon)
{
	if (!Weapon || Weapon->WeaponId.IsNone())
	{
		return;
	}
	Weapons.RemoveAll([Weapon](const UTacWeaponData* Existing) { return Existing && Existing->WeaponId == Weapon->WeaponId; });
	Weapons.Add(Weapon);
	RebuildBuyItems();
}

UTacWeaponData* UTacWeaponCatalog::AddWeapon(FName Id, const TCHAR* Name, ETacWeaponSlot Slot, ETacBuyCategory Category, int32 Price)
{
	UTacWeaponData* Weapon = NewObject<UTacWeaponData>(this, Id);
	Weapon->WeaponId = Id;
	Weapon->DisplayName = FText::FromString(Name);
	Weapon->Slot = Slot;
	Weapon->Category = Category;
	Weapon->Price = Price;
	Weapons.Add(Weapon);
	return Weapon;
}

void UTacWeaponCatalog::BuildDefaultArsenal()
{
	Weapons.Reset();

	// Sidearm every player spawns with.
	{
		UTacWeaponData* W = AddWeapon(TacItems::DefaultSidearm, TEXT("P9 Sidearm"), ETacWeaponSlot::Secondary, ETacBuyCategory::Sidearms, 0);
		W->BaseDamage = 28.f;
		W->ArmorPenetration = 0.5f;
		W->RangeModifier = 0.9f;
		W->RoundsPerMinute = 400.f;
		W->bAutomatic = false;
		W->MagazineSize = 13;
		W->ReserveAmmo = 52;
		W->ReloadTime = 2.2f;
		W->SpreadStanding = 0.35f;
		W->SpreadCrouching = 0.25f;
		W->SpreadMovingAdd = 2.5f;
		W->MoveSpeedMultiplier = 0.96f;
		W->ADSFieldOfView = 70.f;
		W->RecoilRecoveryRate = 10.f;
		W->GenerateRecoilPattern(W->MagazineSize, 4.f, 0.6f, 0.7f, 0.f);
	}

	// Close-range, cheap, mobile.
	{
		UTacWeaponData* W = AddWeapon(TEXT("wasp"), TEXT("Wasp SMG"), ETacWeaponSlot::Primary, ETacBuyCategory::Sidearms, 1250);
		W->KillReward = 600;
		W->BaseDamage = 26.f;
		W->ArmorPenetration = 0.6f;
		W->RangeModifier = 0.85f;
		W->RoundsPerMinute = 800.f;
		W->MagazineSize = 30;
		W->ReserveAmmo = 120;
		W->ReloadTime = 2.3f;
		W->SpreadStanding = 0.45f;
		W->SpreadCrouching = 0.35f;
		W->SpreadMovingAdd = 1.6f;
		W->SpreadAirborneAdd = 5.f;
		W->MoveSpeedMultiplier = 0.94f;
		W->ADSFieldOfView = 68.f;
		W->GenerateRecoilPattern(W->MagazineSize, 5.5f, 1.6f, 0.6f, 0.3f);
	}

	// Attackers' rifle: one headshot kills through a helmet, heavy climb, wide sway.
	{
		UTacWeaponData* W = AddWeapon(TEXT("kodiak"), TEXT("Kodiak AR"), ETacWeaponSlot::Primary, ETacBuyCategory::Rifles, 2700);
		W->TeamOnly = ETacTeam::Attackers;
		W->BaseDamage = 36.f;
		W->ArmorPenetration = 0.775f;
		W->RangeModifier = 0.98f;
		W->RoundsPerMinute = 600.f;
		W->MagazineSize = 30;
		W->ReserveAmmo = 90;
		W->ReloadTime = 2.5f;
		W->SpreadStanding = 0.22f;
		W->SpreadCrouching = 0.14f;
		W->SpreadMovingAdd = 5.f;
		W->MoveSpeedMultiplier = 0.86f;
		W->ADSFieldOfView = 58.f;
		W->GenerateRecoilPattern(W->MagazineSize, 9.5f, 2.8f, 0.42f, -0.7f);
	}

	// Defenders' rifle: faster and steadier, but a helmet survives one headshot.
	{
		UTacWeaponData* W = AddWeapon(TEXT("sentinel"), TEXT("Sentinel AR"), ETacWeaponSlot::Primary, ETacBuyCategory::Rifles, 3100);
		W->TeamOnly = ETacTeam::Defenders;
		W->BaseDamage = 33.f;
		W->ArmorPenetration = 0.7f;
		W->RangeModifier = 0.97f;
		W->RoundsPerMinute = 666.f;
		W->MagazineSize = 30;
		W->ReserveAmmo = 90;
		W->ReloadTime = 3.1f;
		W->SpreadStanding = 0.2f;
		W->SpreadCrouching = 0.12f;
		W->SpreadMovingAdd = 4.5f;
		W->MoveSpeedMultiplier = 0.9f;
		W->ADSFieldOfView = 58.f;
		W->GenerateRecoilPattern(W->MagazineSize, 7.5f, 1.9f, 0.5f, 0.5f);
	}

	// Bolt-action rifle: lethal to the body, useless from the hip or on the move.
	{
		UTacWeaponData* W = AddWeapon(TEXT("longbow"), TEXT("Longbow Sniper"), ETacWeaponSlot::Primary, ETacBuyCategory::Rifles, 4750);
		W->KillReward = 100;
		W->BaseDamage = 115.f;
		W->ArmorPenetration = 0.975f;
		W->RangeModifier = 0.99f;
		W->Range = 20000.f;
		W->RoundsPerMinute = 41.f;
		W->bAutomatic = false;
		W->MagazineSize = 5;
		W->ReserveAmmo = 30;
		W->ReloadTime = 3.6f;
		W->SpreadStanding = 3.5f;
		W->SpreadCrouching = 3.f;
		W->SpreadADSMultiplier = 0.01f;
		W->SpreadMovingAdd = 9.f;
		W->SpreadAirborneAdd = 14.f;
		W->MoveSpeedMultiplier = 0.8f;
		W->ADSMoveSpeedMultiplier = 0.45f;
		W->ADSFieldOfView = 20.f;
		W->RecoilRecoveryRate = 4.f;
		W->GenerateRecoilPattern(W->MagazineSize, 3.f, 0.f, 0.f, 0.f);
	}

	RebuildBuyItems();
}

void UTacWeaponCatalog::RebuildBuyItems()
{
	BuyItems.Reset();

	for (const UTacWeaponData* Weapon : Weapons)
	{
		if (!Weapon || Weapon->WeaponId == TacItems::DefaultSidearm)
		{
			continue;
		}
		FTacBuyItem Item;
		Item.Id = Weapon->WeaponId;
		Item.Name = Weapon->DisplayName;
		Item.Price = Weapon->Price;
		Item.Category = Weapon->Category;
		Item.TeamOnly = Weapon->TeamOnly;
		BuyItems.Add(Item);
	}

	auto AddGear = [this](FName Id, const TCHAR* Name, int32 Price, ETacBuyCategory Category, ETacTeam TeamOnly)
	{
		FTacBuyItem Item;
		Item.Id = Id;
		Item.Name = FText::FromString(Name);
		Item.Price = Price;
		Item.Category = Category;
		Item.TeamOnly = TeamOnly;
		BuyItems.Add(Item);
	};

	AddGear(TacItems::Armor, TEXT("Body Armor"), ArmorPrice, ETacBuyCategory::Gear, ETacTeam::None);
	AddGear(TacItems::ArmorHelmet, TEXT("Armor + Helmet"), ArmorHelmetPrice, ETacBuyCategory::Gear, ETacTeam::None);
	AddGear(TacItems::DefuseKit, TEXT("Defuse Kit"), 400, ETacBuyCategory::Gear, ETacTeam::Defenders);
	AddGear(TacItems::Flash, TEXT("Flashbang"), 200, ETacBuyCategory::Grenades, ETacTeam::None);
	AddGear(TacItems::Smoke, TEXT("Smoke Grenade"), 300, ETacBuyCategory::Grenades, ETacTeam::None);
	AddGear(TacItems::HE, TEXT("HE Grenade"), 300, ETacBuyCategory::Grenades, ETacTeam::None);
}
