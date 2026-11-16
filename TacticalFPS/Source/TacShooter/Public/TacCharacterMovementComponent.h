#pragma once

#include "CoreMinimal.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "TacCharacterMovementComponent.generated.h"

/**
 * Deliberate, tactical movement: run (audible), walk (silent), crouch, jump.
 * Walk and aim-down-sights are sent in the compressed move flags so the speed change
 * is predicted on the client and replayed identically on the server.
 */
UCLASS()
class TACSHOOTER_API UTacCharacterMovementComponent : public UCharacterMovementComponent
{
	GENERATED_BODY()

public:
	UTacCharacterMovementComponent();

	UPROPERTY(EditAnywhere, Category = "Tac Movement")
	float RunSpeed = 450.f;

	UPROPERTY(EditAnywhere, Category = "Tac Movement")
	float WalkSpeed = 235.f;

	UPROPERTY(EditAnywhere, Category = "Tac Movement")
	float CrouchSpeed = 155.f;

	uint8 bWantsToWalk : 1;
	uint8 bWantsADS : 1;

	virtual float GetMaxSpeed() const override;
	virtual bool CanAttemptJump() const override;
	virtual void UpdateFromCompressedFlags(uint8 Flags) override;
	virtual FNetworkPredictionData_Client* GetPredictionData_Client() const override;
};

class FSavedMove_Tac : public FSavedMove_Character
{
public:
	typedef FSavedMove_Character Super;

	uint8 bSavedWantsToWalk : 1;
	uint8 bSavedWantsADS : 1;

	virtual void Clear() override;
	virtual uint8 GetCompressedFlags() const override;
	virtual bool CanCombineWith(const FSavedMovePtr& NewMove, ACharacter* Character, float MaxDelta) const override;
	virtual void SetMoveFor(ACharacter* Character, float InDeltaTime, FVector const& NewAccel, FNetworkPredictionData_Client_Character& ClientData) override;
	virtual void PrepMoveFor(ACharacter* Character) override;
};

class FNetworkPredictionData_Client_Tac : public FNetworkPredictionData_Client_Character
{
public:
	typedef FNetworkPredictionData_Client_Character Super;

	explicit FNetworkPredictionData_Client_Tac(const UCharacterMovementComponent& ClientMovement);
	virtual FSavedMovePtr AllocateNewMove() override;
};
