import meow from "meow";
import path from "path";
import { toProjectReferences } from "./index";

export const cli = meow(
    `
    Usage
      $ workspaces-to-typescript-project-references
 

    Options
      --root             [Path:string] Root directory of the monorepo. 
                         Default: current working directory

      --check            If set the flag, check only differences of tsconfig.json and does not update tsconfig.json.
                         If the check is failed, exit status 1. It is useful for testing.
       
      --plugin           [Path:string] Path to plugin script.
                         Load the plugin script as module and use it. 
                           
      --tsconfigPath     [Path:string] Use alternative config path inside the package. e.g.: tsconfig.test.json
                         Default: tsconfig.json

      --removeComments   If set the flag, removes comments from tsconfig.json.

      --indentation      tsconfig.json indentation number, defaults to 2

      --onlyOnPath       apply changes only on packages children of specified path

      --addInclude

      --addExtends

      --addRootDir

      --addComposite

      --addComposite

      --package

    Examples
      # Update project references in tsconfig.json
      $ workspaces-to-typescript-project-references
      # Test on CI
      $ workspaces-to-typescript-project-references --check
`,
    {
        flags: {
            root: {
                type: "string",
                default: process.cwd()
            },
            check: {
                type: "boolean",
                default: false
            },
            package: {
                type: "string",
                isMultiple: true
            },
            removeComments: {
                type: "boolean",
                default: false
            },
            indentation: {
                type: "number",
                default: 2
            },
            plugin: {
                type: "string",
                isMultiple: true
            },
            onlyOnPath: {
                type: "string"
            },
            addInclude: {
                type: "string",
                isMultiple: true
            },
            addRootDir: {
                type: "string"
            },
            addExtends: {
                type: "string"
            },
            tsconfigPath: {
                type: "string",
                default: "tsconfig.json"
            }
        },
        autoHelp: true,
        autoVersion: true
    }
);

export const run = async (
    _input = cli.input,
    flags = cli.flags
): Promise<{ exitStatus: number; stdout: string | null; stderr: string | null }> => {
    const plugins = Array.isArray(flags.plugin)
        ? flags.plugin.map((pluginPath) => {
              const plugin = require(path.join(process.cwd(), pluginPath));
              if (typeof plugin.plugin !== "function") {
                  throw new Error("plugin should export { plugin }.");
              }
              return plugin.plugin;
          })
        : undefined;
    const customTsConfigFinder = (location: string) => {
        return path.join(location, flags.tsconfigPath);
    };
    const result = toProjectReferences({
        rootDir: flags.root,
        checkOnly: flags.check,
        plugins,
        tsConfigPathFinder: flags.tsconfigPath ? customTsConfigFinder : undefined,
        onlyPackages: flags.package,
        ...flags
    });
    if (result.ok) {
        return {
            exitStatus: 0,
            stdout: flags.check ? "" : "Update Project References!",
            stderr: null
        };
    }
    return {
        exitStatus: 0,
        stdout: null,
        stderr: null
    };
};
