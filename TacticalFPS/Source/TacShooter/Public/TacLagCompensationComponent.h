#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "TacTypes.h"
#include "TacLagCompensationComponent.generated.h"

/** Where a character's hitboxes were at one server tick. */
struct FTacHitboxFrame
{
	float Time = 0.f;
	FVector Location = FVector::ZeroVector; // capsule centre
	float Yaw = 0.f;
	float HalfHeight = 90.f;
};

/**
 * Server-side rewind. Each server tick records where the owner's hitboxes are. When a shot
 * arrives, the server tests it against where the target was when the shooter pulled the
 * trigger, so a hit that was on target on the shooter's screen counts.
 *
 * Hitboxes are analytic shapes built from the capsule (head sphere, chest, stomach and leg
 * boxes), so the server never has to animate skeletons and nothing is moved in the world
 * to do the test.
 */
UCLASS()
class TACSHOOTER_API UTacLagCompensationComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UTacLagCompensationComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** How far back the server keeps frames. */
	UPROPERTY(EditAnywhere, Category = "Lag Compensation")
	float MaxHistorySeconds = 0.4f;

	FTacHitboxFrame GetCurrentFrame() const;

	/** Frame at a past server time, interpolated between the two recorded frames around it. */
	FTacHitboxFrame GetFrameAt(float Time) const;

	/** Tests a ray against the owner's hitboxes as they were at Time. Returns the zone hit and the distance along the ray. */
	ETacHitZone TestRay(float Time, const FVector& Start, const FVector& Direction, float MaxDistance, float& OutDistance) const;

	static ETacHitZone TestRayAgainstFrame(const FTacHitboxFrame& Frame, const FVector& Start, const FVector& Direction, float MaxDistance, float& OutDistance);

private:
	TArray<FTacHitboxFrame> History; // oldest first
};
