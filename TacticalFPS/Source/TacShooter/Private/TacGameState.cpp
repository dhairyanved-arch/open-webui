#include "TacGameState.h"
#include "TacBomb.h"
#include "Net/UnrealNetwork.h"
#include "Engine/World.h"

void ATacGameState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(ATacGameState, MatchType);
	DOREPLIFETIME(ATacGameState, Phase);
	DOREPLIFETIME(ATacGameState, PhaseEndTime);
	DOREPLIFETIME(ATacGameState, AttackerScore);
	DOREPLIFETIME(ATacGameState, DefenderScore);
	DOREPLIFETIME(ATacGameState, RoundNumber);
	DOREPLIFETIME(ATacGameState, LastRoundWinner);
	DOREPLIFETIME(ATacGameState, LastRoundEndReason);
	DOREPLIFETIME(ATacGameState, Bomb);
}

float ATacGameState::GetPhaseTimeRemaining() const
{
	if (PhaseEndTime <= 0.f)
	{
		return 0.f;
	}
	return FMath::Max(0.f, PhaseEndTime - static_cast<float>(GetServerWorldTimeSeconds()));
}

void ATacGameState::OnRep_Phase()
{
	if (const UWorld* World = GetWorld())
	{
		LastPhaseChangeLocalTime = World->GetTimeSeconds();
	}
}

void ATacGameState::MulticastKillFeed_Implementation(const FTacKillFeedEntry& Entry)
{
	FTacKillFeedEntry Local = Entry;
	Local.LocalTime = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
	KillFeed.Add(Local);
	if (KillFeed.Num() > 8)
	{
		KillFeed.RemoveAt(0, KillFeed.Num() - 8);
	}
}
