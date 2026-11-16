#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "TacHUD.generated.h"

class SWidget;

/** Owns the two on-screen layers: the painted HUD (never takes input) and the buy menu (takes taps while open). */
UCLASS()
class TACSHOOTER_API ATacHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
	TSharedPtr<SWidget> HudWidget;
	TSharedPtr<SWidget> BuyMenuWidget;
};
