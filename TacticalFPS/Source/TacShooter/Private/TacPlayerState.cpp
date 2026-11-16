#include "TacPlayerState.h"
#include "Net/UnrealNetwork.h"

void ATacPlayerState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(ATacPlayerState, Team);
	DOREPLIFETIME(ATacPlayerState, Money);
	DOREPLIFETIME(ATacPlayerState, Kills);
	DOREPLIFETIME(ATacPlayerState, Deaths);
	DOREPLIFETIME(ATacPlayerState, bIsAlive);
}
