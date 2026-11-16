#include "TacCharacterMovementComponent.h"
#include "TacCharacter.h"

UTacCharacterMovementComponent::UTacCharacterMovementComponent()
{
	bWantsToWalk = false;
	bWantsADS = false;

	// Quick to get going and quick to stop, so stopping before a shot is a skill rather than a wait.
	MaxAcceleration = 2400.f;
	BrakingDecelerationWalking = 2800.f;
	GroundFriction = 8.f;
	BrakingFrictionFactor = 1.f;

	JumpZVelocity = 380.f;
	AirControl = 0.2f;
	GravityScale = 1.f;

	MaxWalkSpeed = RunSpeed;
	MaxWalkSpeedCrouched = CrouchSpeed;
	SetCrouchedHalfHeight(60.f);
	NavAgentProps.bCanCrouch = true;
	bCanWalkOffLedgesWhenCrouching = true;
}

float UTacCharacterMovementComponent::GetMaxSpeed() const
{
	if (MovementMode != MOVE_Walking && MovementMode != MOVE_NavWalking && MovementMode != MOVE_Falling)
	{
		return Super::GetMaxSpeed();
	}

	const ATacCharacter* TacCharacter = Cast<ATacCharacter>(CharacterOwner);
	if (!TacCharacter)
	{
		return Super::GetMaxSpeed();
	}
	if (TacCharacter->IsMovementLocked())
	{
		return 0.f;
	}

	float Speed = RunSpeed;
	if (IsCrouching())
	{
		Speed = CrouchSpeed;
	}
	else if (bWantsToWalk)
	{
		Speed = WalkSpeed;
	}
	return Speed * TacCharacter->GetWeaponSpeedMultiplier(bWantsADS);
}

bool UTacCharacterMovementComponent::CanAttemptJump() const
{
	const ATacCharacter* TacCharacter = Cast<ATacCharacter>(CharacterOwner);
	if (TacCharacter && TacCharacter->IsMovementLocked())
	{
		return false;
	}
	return Super::CanAttemptJump();
}

void UTacCharacterMovementComponent::UpdateFromCompressedFlags(uint8 Flags)
{
	Super::UpdateFromCompressedFlags(Flags);
	bWantsToWalk = (Flags & FSavedMove_Character::FLAG_Custom_0) != 0;
	bWantsADS = (Flags & FSavedMove_Character::FLAG_Custom_1) != 0;
}

FNetworkPredictionData_Client* UTacCharacterMovementComponent::GetPredictionData_Client() const
{
	if (!ClientPredictionData)
	{
		UTacCharacterMovementComponent* MutableThis = const_cast<UTacCharacterMovementComponent*>(this);
		MutableThis->ClientPredictionData = new FNetworkPredictionData_Client_Tac(*this);
	}
	return ClientPredictionData;
}

void FSavedMove_Tac::Clear()
{
	Super::Clear();
	bSavedWantsToWalk = false;
	bSavedWantsADS = false;
}

uint8 FSavedMove_Tac::GetCompressedFlags() const
{
	uint8 Result = Super::GetCompressedFlags();
	if (bSavedWantsToWalk)
	{
		Result |= FLAG_Custom_0;
	}
	if (bSavedWantsADS)
	{
		Result |= FLAG_Custom_1;
	}
	return Result;
}

bool FSavedMove_Tac::CanCombineWith(const FSavedMovePtr& NewMove, ACharacter* Character, float MaxDelta) const
{
	const FSavedMove_Tac* Other = static_cast<const FSavedMove_Tac*>(NewMove.Get());
	if (bSavedWantsToWalk != Other->bSavedWantsToWalk || bSavedWantsADS != Other->bSavedWantsADS)
	{
		return false;
	}
	return Super::CanCombineWith(NewMove, Character, MaxDelta);
}

void FSavedMove_Tac::SetMoveFor(ACharacter* Character, float InDeltaTime, FVector const& NewAccel, FNetworkPredictionData_Client_Character& ClientData)
{
	Super::SetMoveFor(Character, InDeltaTime, NewAccel, ClientData);
	if (const UTacCharacterMovementComponent* Movement = Cast<UTacCharacterMovementComponent>(Character->GetCharacterMovement()))
	{
		bSavedWantsToWalk = Movement->bWantsToWalk;
		bSavedWantsADS = Movement->bWantsADS;
	}
}

void FSavedMove_Tac::PrepMoveFor(ACharacter* Character)
{
	Super::PrepMoveFor(Character);
	if (UTacCharacterMovementComponent* Movement = Cast<UTacCharacterMovementComponent>(Character->GetCharacterMovement()))
	{
		Movement->bWantsToWalk = bSavedWantsToWalk;
		Movement->bWantsADS = bSavedWantsADS;
	}
}

FNetworkPredictionData_Client_Tac::FNetworkPredictionData_Client_Tac(const UCharacterMovementComponent& ClientMovement)
	: Super(ClientMovement)
{
}

FSavedMovePtr FNetworkPredictionData_Client_Tac::AllocateNewMove()
{
	return FSavedMovePtr(new FSavedMove_Tac());
}
