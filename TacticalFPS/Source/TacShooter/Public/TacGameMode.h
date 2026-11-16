#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "TacTypes.h"
#include "TacGameMode.generated.h"

class ATacBomb;
class ATacCharacter;
class ATacGameState;
class ATacPlayerController;
class ATacPlayerState;

/**
 * The core game loop. Runs on the server only.
 *
 * Bomb defusal:
 *   WaitingForPlayers -> [ BuyPhase -> Live -> (BombPlanted) -> RoundEnd ] x N -> MatchEnd
 *   Sides swap after HalfLength rounds; first team to RoundsToWin takes the match.
 *
 * Team deathmatch:
 *   WaitingForPlayers -> Live (respawns, free loadouts) -> MatchEnd on score or time limit.
 *
 * Pick the mode per map with the URL option ?Mode=TDM or ?Mode=Defuse, or set MatchType on a subclass.
 */
UCLASS()
class TACSHOOTER_API ATacGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ATacGameMode();

	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
	virtual void InitGameState() override;
	virtual void HandleStartingNewPlayer_Implementation(APlayerController* NewPlayer) override;
	virtual void Logout(AController* Exiting) override;
	virtual AActor* ChoosePlayerStart_Implementation(AController* Player) override;
	virtual bool ShouldSpawnAtStartSpot(AController* Player) override { return false; }
	virtual void Tick(float DeltaSeconds) override;

	// ---- Events from gameplay ----

	void NotifyCharacterKilled(ATacCharacter* Victim, AController* VictimController, AController* Killer, FName WeaponId, bool bHeadshot);
	void NotifyBombPlanted(ATacCharacter* Planter, FName Site);
	void NotifyBombDefused(ATacCharacter* Defuser);

	/** Buy menu request. Returns false if the purchase is not allowed. */
	bool TryPurchase(ATacPlayerController* Buyer, FName ItemId);
	bool IsBuyAllowed(const ATacCharacter* Character) const;

	// ---- Rules ----

	UPROPERTY(EditDefaultsOnly, Category = "Rules")
	ETacMatchType MatchType = ETacMatchType::BombDefusal;

	UPROPERTY(EditDefaultsOnly, Category = "Rules")
	int32 PlayersPerTeam = 5;

	/** The match starts once this many players have joined. Use 10 for a full 5v5; 1 is handy for testing alone. */
	UPROPERTY(EditDefaultsOnly, Category = "Rules")
	int32 MinPlayersToStart = 2;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Defusal")
	int32 RoundsToWin = 13;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Defusal")
	int32 HalfLength = 12;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Defusal")
	float BuyTime = 15.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Defusal")
	float RoundTime = 115.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Defusal")
	float BombTime = 40.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Defusal")
	float RoundEndTime = 7.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rules")
	float MatchEndTime = 15.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Deathmatch")
	int32 DeathmatchScoreLimit = 75;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Deathmatch")
	float DeathmatchTimeLimit = 600.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Deathmatch")
	float RespawnDelay = 3.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rules|Deathmatch")
	float DeathmatchBuyWindow = 10.f;

	// ---- Economy (defusal) ----

	UPROPERTY(EditDefaultsOnly, Category = "Economy")
	int32 StartMoney = 800;

	UPROPERTY(EditDefaultsOnly, Category = "Economy")
	int32 MaxMoney = 16000;

	UPROPERTY(EditDefaultsOnly, Category = "Economy")
	int32 WinReward = 3250;

	UPROPERTY(EditDefaultsOnly, Category = "Economy")
	int32 LossReward = 1400;

	/** Added per consecutive loss, up to four. */
	UPROPERTY(EditDefaultsOnly, Category = "Economy")
	int32 LossStreakBonus = 500;

	UPROPERTY(EditDefaultsOnly, Category = "Economy")
	int32 ObjectiveReward = 300;

	/** Paid to each attacker when they lose a round in which the bomb was planted. */
	UPROPERTY(EditDefaultsOnly, Category = "Economy")
	int32 PlantedLossBonus = 800;

	// ---- Level setup ----

	/** PlayerStartTag of the attackers' spawn points. */
	UPROPERTY(EditDefaultsOnly, Category = "Level")
	FName AttackerStartTag = TEXT("Attackers");

	UPROPERTY(EditDefaultsOnly, Category = "Level")
	FName DefenderStartTag = TEXT("Defenders");

	UPROPERTY(EditDefaultsOnly, Category = "Level")
	TSubclassOf<ATacBomb> BombClass;

private:
	struct FPendingRespawn
	{
		TWeakObjectPtr<AController> Controller;
		float Time = 0.f;
	};

	// ---- Loop ----
	void StartMatch();
	void StartRound();
	void BeginLivePhase();
	void EndRound(ETacTeam Winner, ETacRoundEndReason Reason);
	void AdvanceAfterRound();
	void EndMatch(ETacRoundEndReason Reason);
	void SetPhase(ETacRoundPhase NewPhase, float Duration);
	void CheckEliminationWin();
	void SwapSides();

	// ---- Players ----
	void AssignTeam(ATacPlayerState* PlayerState) const;
	void SpawnPlayer(AController* Controller);
	void ResetWorldAndSpawnEveryone(bool bKeepSurvivorLoadouts);
	void SpawnBomb();
	void ProcessRespawns();
	void UpdateSpectators();
	FTacLoadout MakeDefaultLoadout() const;
	int32 CountTeam(ETacTeam Team, bool bAliveOnly) const;
	void AwardMoney(ATacPlayerState* PlayerState, int32 Amount) const;
	bool IsDeathmatch() const { return MatchType == ETacMatchType::TeamDeathmatch; }

	template <typename FuncType>
	void ForEachPlayer(FuncType Func) const;

	TArray<FPendingRespawn> PendingRespawns;
	TSet<TWeakObjectPtr<AActor>> StartsUsedThisRound;

	int32 RoundsPlayed = 0;
	int32 LossStreak[2] = { 0, 0 };      // [0] attackers, [1] defenders
	int32 TeamSizeAtRoundStart[2] = { 0, 0 };
	bool bBombPlantedThisRound = false;
	bool bResetLoadoutsNextRound = false;
	bool bTravelRequested = false;
	float NextSpectatorUpdateTime = 0.f;
};
