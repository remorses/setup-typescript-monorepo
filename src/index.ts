import fs from "fs";
import path from "path";
import commentJSON from "comment-json";
import { plugin as workspacesPlugin } from "./manager/workspaces";
import assert from "assert";
import { PackageManagerPlugin } from "./manager/PackageManagerPlugin";

export type Options = {
    rootDir: string;
    checkOnly: boolean;
    onlyOnPath?: string;
    addRootDir?: string;
    addExtends?: string;
    removeComments?: boolean;
    addComposite?: boolean;
    indentation?: number;
    plugins?: PackageManagerPlugin[];
    tsConfigPathFinder?(location: string): string;
};
export type ToProjectReferencesResult =
    | {
          ok: true;
      }
    | {
          ok: false;
          aggregateError: {
              message: string;
              errors: Error[];
          };
      };
export const toProjectReferences = (options: Options) => {
    const plugins = Array.isArray(options.plugins) && options.plugins.length > 0 ? options.plugins : [workspacesPlugin];
    const pluginImplementations = plugins.map((plugin) => plugin(options));
    // use first plugin
    const supportPlugin = pluginImplementations.find((plugin) => {
        return plugin.supports();
    });
    if (!supportPlugin) {
        throw new Error("Not found supported plugin");
    }
    const relativeName = (pkgPath: string) => {
        return path.relative(options.rootDir, pkgPath);
    };
    const allPackages = supportPlugin.getAllPackages();
    allPackages.forEach((packageInfo) => {
        const tsconfigFilePath =
            options.tsConfigPathFinder?.(packageInfo.location) ?? path.join(packageInfo.location, "tsconfig.json");
        if (!fs.existsSync(tsconfigFilePath)) {
            // Skip has not tsconfig.json
            return;
        }
        if (options.onlyOnPath && !isChildOf(path.resolve(packageInfo.location), path.resolve(options.onlyOnPath))) {
            return;
        }

        const tsconfigJSON = commentJSON.parse(fs.readFileSync(tsconfigFilePath, "utf-8"));
        const newTsconfigJSON = tsconfigJSON;

        if (options.addComposite) {
            const compilerOptions = newTsconfigJSON["compilerOptions"];
            if (!compilerOptions) {
                newTsconfigJSON["compilerOptions"] = {};
            }
            compilerOptions["composite"] = true;
        }

        if (options.addRootDir) {
            const compilerOptions = newTsconfigJSON["compilerOptions"];
            if (!compilerOptions) {
                newTsconfigJSON["compilerOptions"] = {};
            }
            compilerOptions["rootDir"] = options.addRootDir;
        }

        if (options.addExtends) {
            newTsconfigJSON["extends"] = path.relative(
                path.resolve(packageInfo.location),
                path.resolve(options.addExtends)
            );
        }

        const references = supportPlugin.getDependencies(packageInfo.packageJSON);
        const newProjectReferences = references
            .map((reference) => {
                const absolutePathOrNull = supportPlugin.resolve(reference);
                if (!absolutePathOrNull) {
                    return;
                }
                if (!path.isAbsolute(absolutePathOrNull)) {
                    throw new Error(
                        `Plugin#resolve should return absolute path: ${absolutePathOrNull}, plugin: ${supportPlugin}`
                    );
                }
                if (packageInfo.location === absolutePathOrNull) {
                    const selfName = relativeName(packageInfo.location);
                    throw new Error(
                        `[${selfName}] Self dependencies is something wrong: ${selfName} refer to ${relativeName(
                            absolutePathOrNull
                        )}`
                    );
                }
                return {
                    path: path.relative(packageInfo.location, absolutePathOrNull)
                };
            })
            .filter((r) => Boolean(r));

        newTsconfigJSON["references"] = newProjectReferences;

        if (options.checkOnly) {
            assert.deepStrictEqual(pureObject(tsconfigJSON), pureObject(newTsconfigJSON));
        } else {
            // update
            const indentation = options.indentation ?? 2;
            fs.writeFileSync(
                tsconfigFilePath,
                options.removeComments
                    ? JSON.stringify(newTsconfigJSON, null, indentation)
                    : commentJSON.stringify(newTsconfigJSON, null, indentation),
                "utf-8"
            );
        }
    });
    return {
        ok: true
    };
};

function pureObject(x) {
    return JSON.parse(JSON.stringify(commentJSON.parse(commentJSON.stringify(x), undefined, true)));
}

const isChildOf = (child: string, parent: string) => {
    if (child === parent) return false;
    const parentTokens = parent.split("/").filter((i) => i.length);
    const childTokens = child.split("/").filter((i) => i.length);
    return parentTokens.every((t, i) => childTokens[i] === t);
};
