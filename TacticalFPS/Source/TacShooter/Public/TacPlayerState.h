#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerState.h"
#include "TacTypes.h"
#include "TacPlayerState.generated.h"

UCLASS()
class TACSHOOTER_API ATacPlayerState : public APlayerState
{
	GENERATED_BODY()

public:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	ETacTeam Team = ETacTeam::None;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	int32 Money = 0;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	int32 Kills = 0;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	int32 Deaths = 0;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Tac")
	bool bIsAlive = false;

	/** Server only: what this player spawns with next round. */
	FTacLoadout SavedLoadout;
};
