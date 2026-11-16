#pragma once

#include "CoreMinimal.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Widgets/SCompoundWidget.h"
#include "TacTypes.h"

class ATacPlayerController;
struct FTacBuyItem;

/** Pre-round buy menu: four columns of large, thumb-sized buttons built from the weapon catalog. */
class STacBuyMenu : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(STacBuyMenu) {}
		SLATE_ARGUMENT(TWeakObjectPtr<ATacPlayerController>, OwnerPC)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	TSharedRef<SWidget> MakeColumn(ETacBuyCategory Category, const TCHAR* Title) const;
	TSharedRef<SWidget> MakeItemButton(const FTacBuyItem& Item) const;

	TWeakObjectPtr<ATacPlayerController> OwnerPC;
};
