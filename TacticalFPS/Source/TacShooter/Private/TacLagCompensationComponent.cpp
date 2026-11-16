#include "TacLagCompensationComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/Character.h"
#include "Engine/World.h"

namespace
{
	bool RaySphere(const FVector& Start, const FVector& Dir, const FVector& Center, float Radius, float& OutT)
	{
		const FVector ToStart = Start - Center;
		const float B = FVector::DotProduct(ToStart, Dir);
		const float C = FVector::DotProduct(ToStart, ToStart) - Radius * Radius;
		const float Discriminant = B * B - C;
		if (Discriminant < 0.f)
		{
			return false;
		}
		const float Root = FMath::Sqrt(Discriminant);
		float T = -B - Root;
		if (T < 0.f)
		{
			T = -B + Root; // ray starts inside the sphere
		}
		if (T < 0.f)
		{
			return false;
		}
		OutT = T;
		return true;
	}

	bool RayBox(const FVector& Start, const FVector& Dir, const FVector& Center, const FVector& Extent, float& OutT)
	{
		float TMin = 0.f;
		float TMax = TNumericLimits<float>::Max();
		for (int32 Axis = 0; Axis < 3; ++Axis)
		{
			const float Origin = Start[Axis] - Center[Axis];
			const float D = Dir[Axis];
			if (FMath::Abs(D) < KINDA_SMALL_NUMBER)
			{
				if (FMath::Abs(Origin) > Extent[Axis])
				{
					return false;
				}
				continue;
			}
			float T1 = (-Extent[Axis] - Origin) / D;
			float T2 = (Extent[Axis] - Origin) / D;
			if (T1 > T2)
			{
				Swap(T1, T2);
			}
			TMin = FMath::Max(TMin, T1);
			TMax = FMath::Min(TMax, T2);
			if (TMin > TMax)
			{
				return false;
			}
		}
		OutT = TMin;
		return true;
	}
}

UTacLagCompensationComponent::UTacLagCompensationComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PostPhysics;
}

void UTacLagCompensationComponent::BeginPlay()
{
	Super::BeginPlay();
	// Only the server rewinds.
	SetComponentTickEnabled(GetOwner() && GetOwner()->HasAuthority());
}

void UTacLagCompensationComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	const FTacHitboxFrame Frame = GetCurrentFrame();
	History.Add(Frame);

	int32 Expired = 0;
	while (Expired < History.Num() - 1 && Frame.Time - History[Expired].Time > MaxHistorySeconds)
	{
		++Expired;
	}
	if (Expired > 0)
	{
		History.RemoveAt(0, Expired, false);
	}
}

FTacHitboxFrame UTacLagCompensationComponent::GetCurrentFrame() const
{
	FTacHitboxFrame Frame;
	const AActor* Owner = GetOwner();
	if (!Owner)
	{
		return Frame;
	}
	Frame.Time = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
	Frame.Location = Owner->GetActorLocation();
	Frame.Yaw = Owner->GetActorRotation().Yaw;
	if (const ACharacter* Character = Cast<ACharacter>(Owner))
	{
		Frame.HalfHeight = Character->GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
	}
	return Frame;
}

FTacHitboxFrame UTacLagCompensationComponent::GetFrameAt(float Time) const
{
	if (History.Num() == 0 || Time >= History.Last().Time)
	{
		return GetCurrentFrame();
	}
	if (Time <= History[0].Time)
	{
		return History[0];
	}

	for (int32 Index = History.Num() - 2; Index >= 0; --Index)
	{
		const FTacHitboxFrame& Older = History[Index];
		if (Older.Time <= Time)
		{
			const FTacHitboxFrame& Newer = History[Index + 1];
			const float Span = Newer.Time - Older.Time;
			const float Alpha = Span > KINDA_SMALL_NUMBER ? (Time - Older.Time) / Span : 0.f;

			FTacHitboxFrame Result;
			Result.Time = Time;
			Result.Location = FMath::Lerp(Older.Location, Newer.Location, Alpha);
			Result.Yaw = Older.Yaw + FMath::FindDeltaAngleDegrees(Older.Yaw, Newer.Yaw) * Alpha;
			Result.HalfHeight = FMath::Lerp(Older.HalfHeight, Newer.HalfHeight, Alpha);
			return Result;
		}
	}
	return History[0];
}

ETacHitZone UTacLagCompensationComponent::TestRay(float Time, const FVector& Start, const FVector& Direction, float MaxDistance, float& OutDistance) const
{
	return TestRayAgainstFrame(GetFrameAt(Time), Start, Direction, MaxDistance, OutDistance);
}

ETacHitZone UTacLagCompensationComponent::TestRayAgainstFrame(const FTacHitboxFrame& Frame, const FVector& Start, const FVector& Direction, float MaxDistance, float& OutDistance)
{
	// Work in the character's space: origin at the capsule centre, X forward.
	const FQuat ToLocal(FVector::UpVector, -FMath::DegreesToRadians(Frame.Yaw));
	const FVector LocalStart = ToLocal.RotateVector(Start - Frame.Location);
	const FVector LocalDir = ToLocal.RotateVector(Direction);

	const float Height = Frame.HalfHeight * 2.f;
	const float Feet = -Frame.HalfHeight;

	ETacHitZone BestZone = ETacHitZone::None;
	float BestT = MaxDistance;
	float T = 0.f;

	const float HeadRadius = 11.5f;
	if (RaySphere(LocalStart, LocalDir, FVector(3.f, 0.f, Feet + Height - HeadRadius), HeadRadius, T) && T < BestT)
	{
		BestT = T;
		BestZone = ETacHitZone::Head;
	}

	auto TryBox = [&](float CenterHeight, const FVector& Extent, ETacHitZone Zone)
	{
		if (RayBox(LocalStart, LocalDir, FVector(0.f, 0.f, Feet + CenterHeight), Extent, T) && T < BestT)
		{
			BestT = T;
			BestZone = Zone;
		}
	};

	TryBox(0.70f * Height, FVector(15.f, 22.f, 0.14f * Height), ETacHitZone::Chest);
	TryBox(0.49f * Height, FVector(13.f, 19.f, 0.07f * Height), ETacHitZone::Stomach);
	TryBox(0.21f * Height, FVector(12.f, 18.f, 0.21f * Height), ETacHitZone::Legs);

	if (BestZone != ETacHitZone::None)
	{
		OutDistance = BestT;
	}
	return BestZone;
}
