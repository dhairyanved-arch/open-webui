#pragma once

#include "CoreMinimal.h"
#include "TacTypes.generated.h"

UENUM(BlueprintType)
enum class ETacTeam : uint8
{
	None,
	Attackers,
	Defenders,
	Spectator
};

UENUM(BlueprintType)
enum class ETacMatchType : uint8
{
	BombDefusal,
	TeamDeathmatch
};

/** Phases of the core loop. Replicated through ATacGameState. */
UENUM(BlueprintType)
enum class ETacRoundPhase : uint8
{
	WaitingForPlayers,
	BuyPhase,      // freeze time: players are locked at spawn and can buy
	Live,
	BombPlanted,
	RoundEnd,
	MatchEnd
};

UENUM(BlueprintType)
enum class ETacRoundEndReason : uint8
{
	None,
	Elimination,
	TimeExpired,
	BombDetonated,
	BombDefused,
	ScoreLimit
};

UENUM(BlueprintType)
enum class ETacWeaponSlot : uint8
{
	Primary,
	Secondary,
	Grenade
};

UENUM(BlueprintType)
enum class ETacGrenadeType : uint8
{
	Flash,
	Smoke,
	HE
};

UENUM()
enum class ETacHitZone : uint8
{
	None,
	Head,
	Chest,
	Stomach,
	Legs
};

UENUM()
enum class ETacBuyCategory : uint8
{
	Sidearms,
	Rifles,
	Gear,
	Grenades
};

/** Ids of the non-weapon items sold in the buy menu. Weapon ids live in UTacWeaponCatalog. */
namespace TacItems
{
	static const FName Armor(TEXT("armor"));
	static const FName ArmorHelmet(TEXT("armor_helmet"));
	static const FName DefuseKit(TEXT("defuse_kit"));
	static const FName Flash(TEXT("flash"));
	static const FName Smoke(TEXT("smoke"));
	static const FName HE(TEXT("he"));
	static const FName Bomb(TEXT("bomb"));
	static const FName DefaultSidearm(TEXT("p9"));
}

/** Surface byte sent with impact effects when a bullet hit a player. */
static const uint8 TacSurfaceFlesh = 255;

inline ETacTeam TacOpposingTeam(ETacTeam Team)
{
	switch (Team)
	{
	case ETacTeam::Attackers: return ETacTeam::Defenders;
	case ETacTeam::Defenders: return ETacTeam::Attackers;
	default: return ETacTeam::None;
	}
}

/** Everything a player carries. Lives on the character while alive, and is saved on the player state between rounds. */
USTRUCT(BlueprintType)
struct FTacLoadout
{
	GENERATED_BODY()

	UPROPERTY()
	FName PrimaryId;

	UPROPERTY()
	FName SecondaryId;

	UPROPERTY()
	uint8 Armor = 0;

	UPROPERTY()
	bool bHelmet = false;

	UPROPERTY()
	bool bDefuseKit = false;

	UPROPERTY()
	uint8 FlashCount = 0;

	UPROPERTY()
	uint8 SmokeCount = 0;

	UPROPERTY()
	uint8 HECount = 0;

	uint8& GrenadeCount(ETacGrenadeType Type)
	{
		switch (Type)
		{
		case ETacGrenadeType::Flash: return FlashCount;
		case ETacGrenadeType::Smoke: return SmokeCount;
		default: return HECount;
		}
	}

	uint8 GetGrenadeCount(ETacGrenadeType Type) const
	{
		switch (Type)
		{
		case ETacGrenadeType::Flash: return FlashCount;
		case ETacGrenadeType::Smoke: return SmokeCount;
		default: return HECount;
		}
	}

	int32 TotalGrenades() const { return FlashCount + SmokeCount + HECount; }
};

USTRUCT()
struct FTacKillFeedEntry
{
	GENERATED_BODY()

	UPROPERTY()
	FString Killer;

	UPROPERTY()
	FString Victim;

	UPROPERTY()
	ETacTeam KillerTeam = ETacTeam::None;

	UPROPERTY()
	ETacTeam VictimTeam = ETacTeam::None;

	UPROPERTY()
	FName WeaponId;

	UPROPERTY()
	bool bHeadshot = false;

	/** Local receive time, used to fade the entry out. Not replicated. */
	float LocalTime = 0.f;
};
