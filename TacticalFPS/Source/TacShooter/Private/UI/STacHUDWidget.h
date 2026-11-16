#pragma once

#include "CoreMinimal.h"
#include "Widgets/DeclarativeSyntaxSupport.h"
#include "Widgets/SLeafWidget.h"

class ATacCharacter;
class ATacGameState;
class ATacPlayerController;
struct FTacHudPainter;

/**
 * The whole in-game HUD as one painted widget: no widget tree to lay out or tick, a handful of
 * draw calls, and no input handling (touches go to the player controller).
 *
 * Landscape layout, inside the device safe area:
 *
 *   +---------------------------------------------------------------+
 *   | (minimap)                                  score      1:45    |
 *   |   $ money                                         kill feed   |
 *   |                                                   kill feed   |
 *   |                            +                                  |
 *   |                                                     (ADS)     |
 *   |   (stick)              [plant bar]            (R)  (FIRE)     |
 *   |                                                               |
 *   |  HP 100  AP 100          30 / 90        (G) (C)      (J)      |
 *   +---------------------------------------------------------------+
 */
class STacHUDWidget : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(STacHUDWidget) {}
		SLATE_ARGUMENT(TWeakObjectPtr<ATacPlayerController>, OwnerPC)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;

private:
	/** Anchor points for every HUD block, in this widget's local units. */
	struct FLayout
	{
		FVector2D Size = FVector2D::ZeroVector;
		float Unit = 1.f;          // 1 on a 1080-unit-tall screen; all sizes scale with it
		float Left = 0.f;          // safe-area edges with margin applied
		float Top = 0.f;
		float Right = 0.f;
		float Bottom = 0.f;
		FVector2D MinimapCenter = FVector2D::ZeroVector;
		float MinimapRadius = 0.f;
	};

	FLayout ComputeLayout(const FGeometry& Geometry) const;

	void PaintTouchControls(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacCharacter* Character) const;
	void PaintMinimap(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacGameState& GameState) const;
	void PaintClockAndKillFeed(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacGameState& GameState) const;
	void PaintVitals(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacCharacter& Character, const ATacGameState& GameState) const;
	void PaintCrosshair(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacCharacter& Character) const;
	void PaintAnnouncements(const FTacHudPainter& Painter, const FLayout& Layout, const ATacPlayerController& PC, const ATacGameState& GameState) const;

	TWeakObjectPtr<ATacPlayerController> OwnerPC;
};
