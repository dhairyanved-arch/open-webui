#include "TacGameMode.h"
#include "TacBomb.h"
#include "TacCharacter.h"
#include "TacGameState.h"
#include "TacGrenade.h"
#include "TacPlayerController.h"
#include "TacPlayerState.h"
#include "TacShooter.h"
#include "TacWeaponData.h"
#include "UI/TacHUD.h"

#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerStart.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	int32 TeamIndex(ETacTeam Team)
	{
		return Team == ETacTeam::Attackers ? 0 : 1;
	}

	bool IsPlayingTeam(ETacTeam Team)
	{
		return Team == ETacTeam::Attackers || Team == ETacTeam::Defenders;
	}
}

ATacGameMode::ATacGameMode()
{
	PrimaryActorTick.bCanEverTick = true;

	GameStateClass = ATacGameState::StaticClass();
	PlayerStateClass = ATacPlayerState::StaticClass();
	PlayerControllerClass = ATacPlayerController::StaticClass();
	DefaultPawnClass = ATacCharacter::StaticClass();
	HUDClass = ATacHUD::StaticClass();
	bStartPlayersAsSpectators = false;
}

void ATacGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);

	const FString Mode = UGameplayStatics::ParseOption(Options, TEXT("Mode"));
	if (Mode.Equals(TEXT("TDM"), ESearchCase::IgnoreCase))
	{
		MatchType = ETacMatchType::TeamDeathmatch;
	}
	else if (Mode.Equals(TEXT("Defuse"), ESearchCase::IgnoreCase))
	{
		MatchType = ETacMatchType::BombDefusal;
	}
}

void ATacGameMode::InitGameState()
{
	Super::InitGameState();
	if (ATacGameState* TacGameState = GetGameState<ATacGameState>())
	{
		TacGameState->MatchType = MatchType;
		TacGameState->Phase = ETacRoundPhase::WaitingForPlayers;
	}
}

template <typename FuncType>
void ATacGameMode::ForEachPlayer(FuncType Func) const
{
	if (!GameState)
	{
		return;
	}
	// Copy: callbacks may spawn or remove players.
	TArray<APlayerState*> Players;
	Players.Reserve(GameState->PlayerArray.Num());
	for (APlayerState* Player : GameState->PlayerArray)
	{
		Players.Add(Player);
	}
	for (APlayerState* Player : Players)
	{
		ATacPlayerState* TacPlayer = Cast<ATacPlayerState>(Player);
		if (TacPlayer && IsPlayingTeam(TacPlayer->Team))
		{
			Func(TacPlayer);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------------------------------

void ATacGameMode::HandleStartingNewPlayer_Implementation(APlayerController* NewPlayer)
{
	ATacPlayerState* PlayerState = NewPlayer ? NewPlayer->GetPlayerState<ATacPlayerState>() : nullptr;
	const ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!PlayerState || !TacGameState)
	{
		return;
	}

	AssignTeam(PlayerState);
	PlayerState->Money = StartMoney;
	PlayerState->SavedLoadout = MakeDefaultLoadout();

	// Defusal has no respawns: someone who joins mid-round watches until the next one.
	const bool bCanSpawnNow = TacGameState->Phase == ETacRoundPhase::WaitingForPlayers
		|| TacGameState->Phase == ETacRoundPhase::BuyPhase
		|| (IsDeathmatch() && TacGameState->Phase == ETacRoundPhase::Live);

	if (bCanSpawnNow && IsPlayingTeam(PlayerState->Team))
	{
		SpawnPlayer(NewPlayer);
		if (TacGameState->Phase == ETacRoundPhase::BuyPhase)
		{
			++TeamSizeAtRoundStart[TeamIndex(PlayerState->Team)];
		}
	}
	else if (ATacPlayerController* TacController = Cast<ATacPlayerController>(NewPlayer))
	{
		TacController->BeginSpectating();
	}
}

void ATacGameMode::Logout(AController* Exiting)
{
	if (ATacPlayerState* PlayerState = Exiting ? Exiting->GetPlayerState<ATacPlayerState>() : nullptr)
	{
		PlayerState->bIsAlive = false;
		PlayerState->Team = ETacTeam::None;
	}
	Super::Logout(Exiting);
	CheckEliminationWin();
}

void ATacGameMode::AssignTeam(ATacPlayerState* PlayerState) const
{
	const int32 Attackers = CountTeam(ETacTeam::Attackers, false);
	const int32 Defenders = CountTeam(ETacTeam::Defenders, false);

	if (Attackers >= PlayersPerTeam && Defenders >= PlayersPerTeam)
	{
		PlayerState->Team = ETacTeam::Spectator;
	}
	else if (Attackers == Defenders)
	{
		PlayerState->Team = FMath::RandBool() ? ETacTeam::Attackers : ETacTeam::Defenders;
	}
	else
	{
		PlayerState->Team = Attackers < Defenders ? ETacTeam::Attackers : ETacTeam::Defenders;
	}
}

int32 ATacGameMode::CountTeam(ETacTeam Team, bool bAliveOnly) const
{
	int32 Count = 0;
	if (GameState)
	{
		for (const APlayerState* Player : GameState->PlayerArray)
		{
			const ATacPlayerState* TacPlayer = Cast<ATacPlayerState>(Player);
			if (TacPlayer && TacPlayer->Team == Team && (!bAliveOnly || TacPlayer->bIsAlive))
			{
				++Count;
			}
		}
	}
	return Count;
}

FTacLoadout ATacGameMode::MakeDefaultLoadout() const
{
	FTacLoadout Loadout;
	Loadout.SecondaryId = TacItems::DefaultSidearm;
	if (IsDeathmatch())
	{
		Loadout.Armor = 100;
		Loadout.bHelmet = true;
	}
	return Loadout;
}

void ATacGameMode::AwardMoney(ATacPlayerState* PlayerState, int32 Amount) const
{
	if (PlayerState && !IsDeathmatch())
	{
		PlayerState->Money = FMath::Clamp(PlayerState->Money + Amount, 0, MaxMoney);
	}
}

// ---------------------------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------------------------

AActor* ATacGameMode::ChoosePlayerStart_Implementation(AController* Player)
{
	const ATacPlayerState* PlayerState = Player ? Player->GetPlayerState<ATacPlayerState>() : nullptr;
	const ETacTeam Team = PlayerState ? PlayerState->Team : ETacTeam::None;
	const FName WantedTag = Team == ETacTeam::Attackers ? AttackerStartTag : DefenderStartTag;
	const ATacGameState* TacGameState = GetGameState<ATacGameState>();

	TArray<APlayerStart*> AllStarts;
	TArray<APlayerStart*> TeamStarts;
	for (TActorIterator<APlayerStart> It(GetWorld()); It; ++It)
	{
		AllStarts.Add(*It);
		if (It->PlayerStartTag == WantedTag)
		{
			TeamStarts.Add(*It);
		}
	}
	if (AllStarts.Num() == 0)
	{
		return Super::ChoosePlayerStart_Implementation(Player);
	}

	// Deathmatch respawn: the start furthest from any living enemy.
	if (IsDeathmatch() && TacGameState && TacGameState->Phase == ETacRoundPhase::Live)
	{
		APlayerStart* Best = nullptr;
		float BestScore = -1.f;
		for (APlayerStart* Start : AllStarts)
		{
			float Nearest = TNumericLimits<float>::Max();
			for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
			{
				if (It->IsAlive() && It->GetTeam() != Team)
				{
					Nearest = FMath::Min(Nearest, static_cast<float>(FVector::DistSquared(It->GetActorLocation(), Start->GetActorLocation())));
				}
			}
			// A little noise so equal candidates do not always resolve the same way.
			const float Score = Nearest * FMath::FRandRange(0.9f, 1.f);
			if (Score > BestScore)
			{
				BestScore = Score;
				Best = Start;
			}
		}
		return Best;
	}

	// Round start: each player gets their own start on their team's side.
	TArray<APlayerStart*>& Candidates = TeamStarts.Num() > 0 ? TeamStarts : AllStarts;
	for (int32 Index = Candidates.Num() - 1; Index > 0; --Index)
	{
		Candidates.Swap(Index, FMath::RandRange(0, Index));
	}
	for (APlayerStart* Start : Candidates)
	{
		if (!StartsUsedThisRound.Contains(Start))
		{
			StartsUsedThisRound.Add(Start);
			return Start;
		}
	}
	return Candidates[0];
}

void ATacGameMode::SpawnPlayer(AController* Controller)
{
	ATacPlayerState* PlayerState = Controller ? Controller->GetPlayerState<ATacPlayerState>() : nullptr;
	if (!PlayerState || !IsPlayingTeam(PlayerState->Team))
	{
		return;
	}

	if (APawn* OldPawn = Controller->GetPawn())
	{
		Controller->UnPossess();
		OldPawn->Destroy();
	}

	RestartPlayer(Controller);

	if (ATacCharacter* Character = Cast<ATacCharacter>(Controller->GetPawn()))
	{
		PlayerState->bIsAlive = true;
		Character->InitFromLoadout(PlayerState->SavedLoadout);
	}
}

void ATacGameMode::ResetWorldAndSpawnEveryone(bool bKeepSurvivorLoadouts)
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();

	// Survivors keep what they are carrying. Everyone else already had their loadout reset when they died.
	ForEachPlayer([&](ATacPlayerState* PlayerState)
	{
		const AController* Controller = PlayerState->GetOwningController();
		const ATacCharacter* Character = Controller ? Cast<ATacCharacter>(Controller->GetPawn()) : nullptr;
		if (!bKeepSurvivorLoadouts)
		{
			PlayerState->SavedLoadout = MakeDefaultLoadout();
		}
		else if (Character && Character->IsAlive())
		{
			PlayerState->SavedLoadout = Character->GetInventory();
		}
	});

	// Clear the previous round. The bomb goes first so dying carriers do not drop it.
	if (TacGameState && IsValid(TacGameState->Bomb))
	{
		TacGameState->Bomb->Destroy();
	}
	if (TacGameState)
	{
		TacGameState->Bomb = nullptr;
	}

	TArray<AActor*> ToDestroy;
	for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
	{
		ToDestroy.Add(*It);
	}
	for (TActorIterator<ATacGrenade> It(GetWorld()); It; ++It)
	{
		ToDestroy.Add(*It);
	}
	for (AActor* Actor : ToDestroy)
	{
		if (APawn* Pawn = Cast<APawn>(Actor))
		{
			if (AController* Controller = Pawn->GetController())
			{
				Controller->UnPossess();
			}
		}
		Actor->Destroy();
	}

	StartsUsedThisRound.Reset();
	PendingRespawns.Reset();

	ForEachPlayer([this](ATacPlayerState* PlayerState)
	{
		SpawnPlayer(PlayerState->GetOwningController());
	});
}

void ATacGameMode::SpawnBomb()
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState)
	{
		return;
	}

	TArray<ATacCharacter*> Attackers;
	for (TActorIterator<ATacCharacter> It(GetWorld()); It; ++It)
	{
		if (It->IsAlive() && It->GetTeam() == ETacTeam::Attackers)
		{
			Attackers.Add(*It);
		}
	}
	if (Attackers.Num() == 0)
	{
		return;
	}

	ATacCharacter* Carrier = Attackers[FMath::RandRange(0, Attackers.Num() - 1)];
	UClass* ClassToSpawn = BombClass ? BombClass.Get() : ATacBomb::StaticClass();
	FActorSpawnParameters SpawnParams;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	if (ATacBomb* Bomb = GetWorld()->SpawnActor<ATacBomb>(ClassToSpawn, Carrier->GetFeetLocation(), FRotator::ZeroRotator, SpawnParams))
	{
		TacGameState->Bomb = Bomb;
		Bomb->GiveTo(Carrier);
	}
}

void ATacGameMode::ProcessRespawns()
{
	const float Now = GetWorld()->GetTimeSeconds();
	for (int32 Index = PendingRespawns.Num() - 1; Index >= 0; --Index)
	{
		if (Now < PendingRespawns[Index].Time)
		{
			continue;
		}
		AController* Controller = PendingRespawns[Index].Controller.Get();
		PendingRespawns.RemoveAtSwap(Index);
		if (Controller)
		{
			SpawnPlayer(Controller);
		}
	}
}

void ATacGameMode::UpdateSpectators()
{
	for (FConstPlayerControllerIterator It = GetWorld()->GetPlayerControllerIterator(); It; ++It)
	{
		if (ATacPlayerController* Controller = Cast<ATacPlayerController>(It->Get()))
		{
			Controller->UpdateSpectating();
		}
	}
}

// ---------------------------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------------------------

void ATacGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState)
	{
		return;
	}

	const float Now = GetWorld()->GetTimeSeconds();
	if (Now >= NextSpectatorUpdateTime)
	{
		NextSpectatorUpdateTime = Now + 0.5f;
		UpdateSpectators();
	}

	const bool bClockExpired = TacGameState->HasPhaseClock() && TacGameState->GetPhaseTimeRemaining() <= 0.f;

	switch (TacGameState->Phase)
	{
	case ETacRoundPhase::WaitingForPlayers:
		if (CountTeam(ETacTeam::Attackers, false) + CountTeam(ETacTeam::Defenders, false) >= MinPlayersToStart)
		{
			StartMatch();
		}
		break;

	case ETacRoundPhase::BuyPhase:
		if (bClockExpired)
		{
			BeginLivePhase();
		}
		break;

	case ETacRoundPhase::Live:
		if (IsDeathmatch())
		{
			ProcessRespawns();
			if (bClockExpired)
			{
				EndMatch(ETacRoundEndReason::TimeExpired);
			}
		}
		else if (bClockExpired)
		{
			// Attackers ran out of time without planting.
			EndRound(ETacTeam::Defenders, ETacRoundEndReason::TimeExpired);
		}
		break;

	case ETacRoundPhase::BombPlanted:
		if (bClockExpired)
		{
			ATacBomb* Bomb = TacGameState->Bomb;
			EndRound(ETacTeam::Attackers, ETacRoundEndReason::BombDetonated);
			if (IsValid(Bomb))
			{
				Bomb->Explode();
			}
		}
		break;

	case ETacRoundPhase::RoundEnd:
		if (bClockExpired)
		{
			AdvanceAfterRound();
		}
		break;

	case ETacRoundPhase::MatchEnd:
		if (bClockExpired && !bTravelRequested)
		{
			bTravelRequested = true;
			GetWorld()->ServerTravel(TEXT("?Restart"), false);
		}
		break;
	}
}

void ATacGameMode::SetPhase(ETacRoundPhase NewPhase, float Duration)
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState)
	{
		return;
	}
	TacGameState->Phase = NewPhase;
	TacGameState->PhaseEndTime = Duration > 0.f ? static_cast<float>(TacGameState->GetServerWorldTimeSeconds()) + Duration : 0.f;
	TacGameState->OnRep_Phase(); // the server's own HUD (listen server) reacts too
	TacGameState->ForceNetUpdate();
	UE_LOG(LogTac, Log, TEXT("Phase -> %s (%.0fs)"), *UEnum::GetValueAsString(NewPhase), Duration);
}

void ATacGameMode::StartMatch()
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState)
	{
		return;
	}

	TacGameState->AttackerScore = 0;
	TacGameState->DefenderScore = 0;
	TacGameState->RoundNumber = 0;
	TacGameState->LastRoundWinner = ETacTeam::None;
	TacGameState->LastRoundEndReason = ETacRoundEndReason::None;
	RoundsPlayed = 0;
	LossStreak[0] = LossStreak[1] = 0;
	bResetLoadoutsNextRound = true;

	ForEachPlayer([this](ATacPlayerState* PlayerState)
	{
		PlayerState->Money = StartMoney;
		PlayerState->Kills = 0;
		PlayerState->Deaths = 0;
	});

	if (IsDeathmatch())
	{
		ResetWorldAndSpawnEveryone(false);
		SetPhase(ETacRoundPhase::Live, DeathmatchTimeLimit);
	}
	else
	{
		StartRound();
	}
}

void ATacGameMode::StartRound()
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState)
	{
		return;
	}

	++TacGameState->RoundNumber;
	bBombPlantedThisRound = false;

	ResetWorldAndSpawnEveryone(!bResetLoadoutsNextRound);
	bResetLoadoutsNextRound = false;

	TeamSizeAtRoundStart[0] = CountTeam(ETacTeam::Attackers, true);
	TeamSizeAtRoundStart[1] = CountTeam(ETacTeam::Defenders, true);

	SpawnBomb();

	// Freeze time: everyone is locked at spawn and the buy menu is open.
	SetPhase(ETacRoundPhase::BuyPhase, BuyTime);
}

void ATacGameMode::BeginLivePhase()
{
	SetPhase(ETacRoundPhase::Live, RoundTime);
	CheckEliminationWin();
}

void ATacGameMode::CheckEliminationWin()
{
	const ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState || IsDeathmatch())
	{
		return;
	}
	if (TacGameState->Phase != ETacRoundPhase::Live && TacGameState->Phase != ETacRoundPhase::BombPlanted)
	{
		return;
	}

	// A side that started the round empty (testing alone) cannot be "eliminated".
	const bool bAttackersOut = TeamSizeAtRoundStart[0] > 0 && CountTeam(ETacTeam::Attackers, true) == 0;
	const bool bDefendersOut = TeamSizeAtRoundStart[1] > 0 && CountTeam(ETacTeam::Defenders, true) == 0;

	if (bDefendersOut)
	{
		EndRound(ETacTeam::Attackers, ETacRoundEndReason::Elimination);
	}
	else if (bAttackersOut && TacGameState->Phase == ETacRoundPhase::Live)
	{
		// Once the bomb is down, killing the attackers is not enough: it still has to be defused.
		EndRound(ETacTeam::Defenders, ETacRoundEndReason::Elimination);
	}
}

void ATacGameMode::EndRound(ETacTeam Winner, ETacRoundEndReason Reason)
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState || (TacGameState->Phase != ETacRoundPhase::Live && TacGameState->Phase != ETacRoundPhase::BombPlanted))
	{
		return;
	}

	const ETacTeam Loser = TacOpposingTeam(Winner);
	if (Winner == ETacTeam::Attackers)
	{
		++TacGameState->AttackerScore;
	}
	else
	{
		++TacGameState->DefenderScore;
	}
	++RoundsPlayed;
	TacGameState->LastRoundWinner = Winner;
	TacGameState->LastRoundEndReason = Reason;

	// Economy: winners get a flat reward, losers get more the longer their losing streak.
	const int32 LoserStreak = FMath::Min(LossStreak[TeamIndex(Loser)], 4);
	const bool bPlantBonus = Loser == ETacTeam::Attackers && bBombPlantedThisRound;
	ForEachPlayer([&](ATacPlayerState* PlayerState)
	{
		if (PlayerState->Team == Winner)
		{
			AwardMoney(PlayerState, WinReward);
		}
		else
		{
			AwardMoney(PlayerState, LossReward + LossStreakBonus * LoserStreak + (bPlantBonus ? PlantedLossBonus : 0));
		}
	});
	LossStreak[TeamIndex(Winner)] = 0;
	++LossStreak[TeamIndex(Loser)];

	SetPhase(ETacRoundPhase::RoundEnd, RoundEndTime);
}

void ATacGameMode::AdvanceAfterRound()
{
	const ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState)
	{
		return;
	}

	const bool bSomeoneWon = TacGameState->AttackerScore >= RoundsToWin || TacGameState->DefenderScore >= RoundsToWin;
	if (bSomeoneWon || RoundsPlayed >= HalfLength * 2)
	{
		EndMatch(ETacRoundEndReason::ScoreLimit);
		return;
	}

	if (RoundsPlayed == HalfLength)
	{
		SwapSides();
	}
	StartRound();
}

void ATacGameMode::SwapSides()
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState)
	{
		return;
	}

	ForEachPlayer([this](ATacPlayerState* PlayerState)
	{
		PlayerState->Team = TacOpposingTeam(PlayerState->Team);
		PlayerState->Money = StartMoney;
	});

	// Scores follow the players, not the side. The economy starts over.
	Swap(TacGameState->AttackerScore, TacGameState->DefenderScore);
	LossStreak[0] = LossStreak[1] = 0;
	bResetLoadoutsNextRound = true;
}

void ATacGameMode::EndMatch(ETacRoundEndReason Reason)
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState || TacGameState->Phase == ETacRoundPhase::MatchEnd)
	{
		return;
	}

	if (TacGameState->AttackerScore == TacGameState->DefenderScore)
	{
		TacGameState->LastRoundWinner = ETacTeam::None; // draw
	}
	else
	{
		TacGameState->LastRoundWinner = TacGameState->AttackerScore > TacGameState->DefenderScore ? ETacTeam::Attackers : ETacTeam::Defenders;
	}
	TacGameState->LastRoundEndReason = Reason;
	PendingRespawns.Reset();
	SetPhase(ETacRoundPhase::MatchEnd, MatchEndTime);
}

// ---------------------------------------------------------------------------------------------
// Gameplay events
// ---------------------------------------------------------------------------------------------

void ATacGameMode::NotifyCharacterKilled(ATacCharacter* Victim, AController* VictimController, AController* Killer, FName WeaponId, bool bHeadshot)
{
	ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState || !Victim)
	{
		return;
	}

	ATacPlayerState* VictimState = VictimController ? VictimController->GetPlayerState<ATacPlayerState>() : nullptr;
	ATacPlayerState* KillerState = Killer ? Killer->GetPlayerState<ATacPlayerState>() : nullptr;

	if (VictimState)
	{
		++VictimState->Deaths;
		VictimState->bIsAlive = false;
		if (IsDeathmatch())
		{
			// Keep the guns, come back with fresh armor.
			VictimState->SavedLoadout = Victim->GetInventory();
			VictimState->SavedLoadout.Armor = 100;
			VictimState->SavedLoadout.bHelmet = true;
		}
		else
		{
			VictimState->SavedLoadout = MakeDefaultLoadout();
		}
	}

	const bool bEnemyKill = KillerState && VictimState && KillerState != VictimState && KillerState->Team != VictimState->Team;
	if (bEnemyKill)
	{
		++KillerState->Kills;
		if (IsDeathmatch())
		{
			if (KillerState->Team == ETacTeam::Attackers)
			{
				++TacGameState->AttackerScore;
			}
			else
			{
				++TacGameState->DefenderScore;
			}
		}
		else
		{
			const UTacWeaponCatalog* Catalog = UTacWeaponCatalog::Get(this);
			const UTacWeaponData* Weapon = Catalog ? Catalog->FindWeapon(WeaponId) : nullptr;
			AwardMoney(KillerState, Weapon ? Weapon->KillReward : 300);
		}
	}

	FTacKillFeedEntry Entry;
	Entry.Killer = bEnemyKill ? KillerState->GetPlayerName() : FString();
	Entry.KillerTeam = bEnemyKill ? KillerState->Team : ETacTeam::None;
	Entry.Victim = VictimState ? VictimState->GetPlayerName() : TEXT("?");
	Entry.VictimTeam = Victim->GetTeam();
	Entry.WeaponId = WeaponId;
	Entry.bHeadshot = bHeadshot;
	TacGameState->MulticastKillFeed(Entry);

	if (VictimController)
	{
		VictimController->UnPossess();
		if (ATacPlayerController* TacController = Cast<ATacPlayerController>(VictimController))
		{
			TacController->BeginSpectating();
		}
	}

	if (IsDeathmatch())
	{
		Victim->SetLifeSpan(8.f);
		if (TacGameState->Phase == ETacRoundPhase::Live)
		{
			if (VictimController)
			{
				FPendingRespawn Respawn;
				Respawn.Controller = VictimController;
				Respawn.Time = GetWorld()->GetTimeSeconds() + RespawnDelay;
				PendingRespawns.Add(Respawn);
			}
			if (TacGameState->AttackerScore >= DeathmatchScoreLimit || TacGameState->DefenderScore >= DeathmatchScoreLimit)
			{
				EndMatch(ETacRoundEndReason::ScoreLimit);
			}
		}
	}
	else
	{
		CheckEliminationWin();
	}
}

void ATacGameMode::NotifyBombPlanted(ATacCharacter* Planter, FName Site)
{
	const ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!TacGameState || TacGameState->Phase != ETacRoundPhase::Live)
	{
		return;
	}
	bBombPlantedThisRound = true;
	if (Planter)
	{
		AwardMoney(Planter->GetPlayerState<ATacPlayerState>(), ObjectiveReward);
	}
	// The round clock is replaced by the bomb's fuse.
	SetPhase(ETacRoundPhase::BombPlanted, BombTime);
	CheckEliminationWin();
}

void ATacGameMode::NotifyBombDefused(ATacCharacter* Defuser)
{
	if (Defuser)
	{
		AwardMoney(Defuser->GetPlayerState<ATacPlayerState>(), ObjectiveReward);
	}
	EndRound(ETacTeam::Defenders, ETacRoundEndReason::BombDefused);
}

// ---------------------------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------------------------

bool ATacGameMode::IsBuyAllowed(const ATacCharacter* Character) const
{
	const ATacGameState* TacGameState = GetGameState<ATacGameState>();
	if (!Character || !Character->IsAlive() || !TacGameState)
	{
		return false;
	}
	if (IsDeathmatch())
	{
		return TacGameState->Phase == ETacRoundPhase::Live
			&& GetWorld()->GetTimeSeconds() - Character->SpawnLocalTime <= DeathmatchBuyWindow;
	}
	return TacGameState->Phase == ETacRoundPhase::BuyPhase;
}

bool ATacGameMode::TryPurchase(ATacPlayerController* Buyer, FName ItemId)
{
	ATacPlayerState* PlayerState = Buyer ? Buyer->GetPlayerState<ATacPlayerState>() : nullptr;
	ATacCharacter* Character = Buyer ? Cast<ATacCharacter>(Buyer->GetPawn()) : nullptr;
	const UTacWeaponCatalog* Catalog = UTacWeaponCatalog::Get(this);
	if (!PlayerState || !Catalog || !IsBuyAllowed(Character))
	{
		return false;
	}

	const FTacBuyItem* Item = Catalog->FindBuyItem(ItemId);
	if (!Item || (Item->TeamOnly != ETacTeam::None && Item->TeamOnly != PlayerState->Team))
	{
		return false;
	}

	const FTacLoadout& Inventory = Character->GetInventory();
	const UTacWeaponData* Weapon = Catalog->FindWeapon(ItemId);
	int32 Price = Item->Price;

	// Is there room for it?
	if (Weapon)
	{
		if (Inventory.PrimaryId == ItemId || Inventory.SecondaryId == ItemId)
		{
			return false;
		}
	}
	else if (ItemId == TacItems::Armor)
	{
		if (Inventory.Armor >= 100)
		{
			return false;
		}
	}
	else if (ItemId == TacItems::ArmorHelmet)
	{
		if (Inventory.Armor >= 100 && Inventory.bHelmet)
		{
			return false;
		}
		if (Inventory.Armor >= 100)
		{
			Price = UTacWeaponCatalog::HelmetOnlyPrice;
		}
	}
	else if (ItemId == TacItems::DefuseKit)
	{
		if (Inventory.bDefuseKit)
		{
			return false;
		}
	}
	else if (ItemId == TacItems::Flash)
	{
		if (Inventory.FlashCount >= 2 || Inventory.TotalGrenades() >= 4)
		{
			return false;
		}
	}
	else if (ItemId == TacItems::Smoke)
	{
		if (Inventory.SmokeCount >= 1 || Inventory.TotalGrenades() >= 4)
		{
			return false;
		}
	}
	else if (ItemId == TacItems::HE)
	{
		if (Inventory.HECount >= 1 || Inventory.TotalGrenades() >= 4)
		{
			return false;
		}
	}
	else
	{
		return false;
	}

	if (IsDeathmatch())
	{
		Price = 0;
	}
	if (PlayerState->Money < Price)
	{
		return false;
	}
	PlayerState->Money -= Price;

	if (Weapon)
	{
		Character->GiveWeapon(Weapon);
	}
	else if (ItemId == TacItems::Armor)
	{
		Character->GiveArmor(false);
	}
	else if (ItemId == TacItems::ArmorHelmet)
	{
		Character->GiveArmor(true);
	}
	else if (ItemId == TacItems::DefuseKit)
	{
		Character->GiveDefuseKit();
	}
	else if (ItemId == TacItems::Flash)
	{
		Character->AddGrenade(ETacGrenadeType::Flash);
	}
	else if (ItemId == TacItems::Smoke)
	{
		Character->AddGrenade(ETacGrenadeType::Smoke);
	}
	else
	{
		Character->AddGrenade(ETacGrenadeType::HE);
	}
	return true;
}
