#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameStateBase.h"
#include "TacTypes.h"
#include "TacGameState.generated.h"

class ATacBomb;

/** Replicated view of the match that every client needs: phase, clock, score, bomb and kill feed. */
UCLASS()
class TACSHOOTER_API ATacGameState : public AGameStateBase
{
	GENERATED_BODY()

public:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	ETacMatchType MatchType = ETacMatchType::BombDefusal;

	UPROPERTY(ReplicatedUsing = OnRep_Phase, BlueprintReadOnly, Category = "Tac")
	ETacRoundPhase Phase = ETacRoundPhase::WaitingForPlayers;

	/** Server world time at which the current phase ends. Zero means the phase has no clock. */
	UPROPERTY(Replicated)
	float PhaseEndTime = 0.f;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	int32 AttackerScore = 0;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	int32 DefenderScore = 0;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	int32 RoundNumber = 0;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	ETacTeam LastRoundWinner = ETacTeam::None;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	ETacRoundEndReason LastRoundEndReason = ETacRoundEndReason::None;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	TObjectPtr<ATacBomb> Bomb;

	UFUNCTION(NetMulticast, Reliable)
	void MulticastKillFeed(const FTacKillFeedEntry& Entry);

	/** Seconds left in the current phase, or zero if the phase has no clock. */
	float GetPhaseTimeRemaining() const;
	bool HasPhaseClock() const { return PhaseEndTime > 0.f; }

	/** Players are locked in place at spawn. */
	bool IsFreezeTime() const { return Phase == ETacRoundPhase::BuyPhase; }

	/** Weapons can be fired and damage is applied. */
	bool IsCombatAllowed() const { return Phase != ETacRoundPhase::BuyPhase && Phase != ETacRoundPhase::MatchEnd; }

	int32 GetScore(ETacTeam Team) const { return Team == ETacTeam::Attackers ? AttackerScore : DefenderScore; }

	/** Local world time of the last phase change, for HUD announcements. */
	float LastPhaseChangeLocalTime = 0.f;

	/** Newest entries last. Local only. */
	TArray<FTacKillFeedEntry> KillFeed;

	UFUNCTION()
	void OnRep_Phase();
};
