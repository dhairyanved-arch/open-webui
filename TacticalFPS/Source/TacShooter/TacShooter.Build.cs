using UnrealBuildTool;

public class TacShooter : ModuleRules
{
	public TacShooter(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"NetCore",
			"PhysicsCore",
			"Niagara",
			"Slate",
			"SlateCore",
			"ApplicationCore"
		});
	}
}
