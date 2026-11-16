#include "UI/STacBuyMenu.h"
#include "TacGameState.h"
#include "TacPlayerController.h"
#include "TacPlayerState.h"
#include "TacWeaponData.h"

#include "Engine/World.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	FSlateFontInfo BuyFont(int32 Size)
	{
		return FCoreStyle::GetDefaultFontStyle("Bold", Size);
	}
}

void STacBuyMenu::Construct(const FArguments& InArgs)
{
	OwnerPC = InArgs._OwnerPC;
	const TWeakObjectPtr<ATacPlayerController> WeakPC = OwnerPC;

	SetVisibility(TAttribute<EVisibility>::CreateLambda([WeakPC]()
	{
		return WeakPC.IsValid() && WeakPC->IsBuyMenuOpen() ? EVisibility::Visible : EVisibility::Collapsed;
	}));

	ChildSlot
	.HAlign(HAlign_Center)
	.VAlign(VAlign_Center)
	[
		SNew(SBorder)
		.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
		.BorderBackgroundColor(FLinearColor(0.02f, 0.03f, 0.05f, 0.92f))
		.Padding(FMargin(28.f, 20.f))
		[
			SNew(SVerticalBox)

			// Header: title, money, close.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.f, 0.f, 0.f, 16.f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.FillWidth(1.f)
				.VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text(FText::FromString(TEXT("BUY")))
					.Font(BuyFont(26))
					.ColorAndOpacity(FLinearColor::White)
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(0.f, 0.f, 24.f, 0.f)
				[
					SNew(STextBlock)
					.Text_Lambda([WeakPC]()
					{
						const ATacPlayerState* PlayerState = WeakPC.IsValid() ? WeakPC->GetPlayerState<ATacPlayerState>() : nullptr;
						return FText::FromString(FString::Printf(TEXT("$ %d"), PlayerState ? PlayerState->Money : 0));
					})
					.Font(BuyFont(22))
					.ColorAndOpacity(FLinearColor(0.45f, 0.9f, 0.45f))
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				[
					SNew(SButton)
					.OnClicked_Lambda([WeakPC]()
					{
						if (WeakPC.IsValid())
						{
							WeakPC->SetBuyMenuOpen(false);
						}
						return FReply::Handled();
					})
					[
						SNew(SBox)
						.MinDesiredWidth(110.f)
						.MinDesiredHeight(56.f)
						.HAlign(HAlign_Center)
						.VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Text(FText::FromString(TEXT("CLOSE")))
							.Font(BuyFont(16))
							.ColorAndOpacity(FLinearColor::Black)
						]
					]
				]
			]

			// Items, one column per category.
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().Padding(0.f, 0.f, 16.f, 0.f)
				[
					MakeColumn(ETacBuyCategory::Sidearms, TEXT("LIGHT"))
				]
				+ SHorizontalBox::Slot().AutoWidth().Padding(0.f, 0.f, 16.f, 0.f)
				[
					MakeColumn(ETacBuyCategory::Rifles, TEXT("RIFLES"))
				]
				+ SHorizontalBox::Slot().AutoWidth().Padding(0.f, 0.f, 16.f, 0.f)
				[
					MakeColumn(ETacBuyCategory::Gear, TEXT("GEAR"))
				]
				+ SHorizontalBox::Slot().AutoWidth()
				[
					MakeColumn(ETacBuyCategory::Grenades, TEXT("GRENADES"))
				]
			]
		]
	];
}

TSharedRef<SWidget> STacBuyMenu::MakeColumn(ETacBuyCategory Category, const TCHAR* Title) const
{
	TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);

	Column->AddSlot()
	.AutoHeight()
	.Padding(0.f, 0.f, 0.f, 10.f)
	[
		SNew(STextBlock)
		.Text(FText::FromString(Title))
		.Font(BuyFont(14))
		.ColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, 0.6f))
	];

	if (const UTacWeaponCatalog* Catalog = UTacWeaponCatalog::Get(OwnerPC.Get()))
	{
		for (const FTacBuyItem& Item : Catalog->GetBuyItems())
		{
			if (Item.Category == Category)
			{
				Column->AddSlot().AutoHeight()
				[
					MakeItemButton(Item)
				];
			}
		}
	}
	return Column;
}

TSharedRef<SWidget> STacBuyMenu::MakeItemButton(const FTacBuyItem& Item) const
{
	const TWeakObjectPtr<ATacPlayerController> WeakPC = OwnerPC;
	const FName ItemId = Item.Id;
	const ETacTeam TeamOnly = Item.TeamOnly;
	const int32 Price = Item.Price;

	return SNew(SBox)
		.Padding(FMargin(0.f, 0.f, 0.f, 10.f))
		// Team-locked items are hidden for the other side (sides swap at half time, so this is checked live).
		.Visibility_Lambda([WeakPC, TeamOnly]()
		{
			const bool bForMyTeam = TeamOnly == ETacTeam::None || (WeakPC.IsValid() && WeakPC->GetTeam() == TeamOnly);
			return bForMyTeam ? EVisibility::Visible : EVisibility::Collapsed;
		})
		[
			SNew(SButton)
			.IsEnabled_Lambda([WeakPC, ItemId]()
			{
				return WeakPC.IsValid() && WeakPC->CanAffordItem(ItemId);
			})
			.OnClicked_Lambda([WeakPC, ItemId]()
			{
				if (WeakPC.IsValid())
				{
					WeakPC->RequestBuy(ItemId);
				}
				return FReply::Handled();
			})
			[
				SNew(SBox)
				.MinDesiredWidth(250.f)
				.MinDesiredHeight(64.f)
				.VAlign(VAlign_Center)
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot()
					.FillWidth(1.f)
					.VAlign(VAlign_Center)
					[
						SNew(STextBlock)
						.Text(Item.Name)
						.Font(BuyFont(16))
						.ColorAndOpacity(FLinearColor::Black)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(16.f, 0.f, 0.f, 0.f)
					[
						SNew(STextBlock)
						.Text_Lambda([WeakPC, Price]()
						{
							// Everything is free in deathmatch.
							const UWorld* World = WeakPC.IsValid() ? WeakPC->GetWorld() : nullptr;
							const ATacGameState* GameState = World ? World->GetGameState<ATacGameState>() : nullptr;
							const bool bFree = GameState && GameState->MatchType == ETacMatchType::TeamDeathmatch;
							return FText::FromString(bFree ? FString(TEXT("FREE")) : FString::Printf(TEXT("$%d"), Price));
						})
						.Font(BuyFont(16))
						.ColorAndOpacity(FLinearColor(0.05f, 0.3f, 0.05f))
					]
				]
			]
		];
}
