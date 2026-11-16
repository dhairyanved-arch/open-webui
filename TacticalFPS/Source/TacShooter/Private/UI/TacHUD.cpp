#include "UI/TacHUD.h"
#include "UI/STacBuyMenu.h"
#include "UI/STacHUDWidget.h"
#include "TacPlayerController.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"

void ATacHUD::BeginPlay()
{
	Super::BeginPlay();

	ATacPlayerController* PC = Cast<ATacPlayerController>(GetOwningPlayerController());
	if (!PC || !PC->IsLocalController() || !GEngine || !GEngine->GameViewport)
	{
		return;
	}

	// The HUD layer is display only. Touches pass through it to the player controller.
	HudWidget = SNew(STacHUDWidget).OwnerPC(PC);
	HudWidget->SetVisibility(EVisibility::HitTestInvisible);
	GEngine->GameViewport->AddViewportWidgetContent(HudWidget.ToSharedRef(), 0);

	// The buy menu sits above it and is only hit-testable while open.
	BuyMenuWidget = SNew(STacBuyMenu).OwnerPC(PC);
	GEngine->GameViewport->AddViewportWidgetContent(BuyMenuWidget.ToSharedRef(), 10);
}

void ATacHUD::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (GEngine && GEngine->GameViewport)
	{
		if (HudWidget.IsValid())
		{
			GEngine->GameViewport->RemoveViewportWidgetContent(HudWidget.ToSharedRef());
		}
		if (BuyMenuWidget.IsValid())
		{
			GEngine->GameViewport->RemoveViewportWidgetContent(BuyMenuWidget.ToSharedRef());
		}
	}
	HudWidget.Reset();
	BuyMenuWidget.Reset();
	Super::EndPlay(EndPlayReason);
}
