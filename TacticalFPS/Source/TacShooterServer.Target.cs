using UnrealBuildTool;

// Dedicated server target. Requires a source build of the engine.
public class TacShooterServerTarget : TargetRules
{
	public TacShooterServerTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Server;
		DefaultBuildSettings = BuildSettingsVersion.V2;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_2;
		ExtraModuleNames.Add("TacShooter");
	}
}
