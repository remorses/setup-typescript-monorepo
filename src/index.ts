import fs, { writeFileSync, existsSync } from "fs";
import path from "path";
import commentJSON from "comment-json";
import { plugin as workspacesPlugin } from "./manager/workspaces";
import assert from "assert";
import { PackageManagerPlugin } from "./manager/PackageManagerPlugin";

export const UNSET_FLAG = "__unset__";

export type Options = {
    rootDir: string;
    checkOnly: boolean;
    onlyOnPath?: string;
    addInclude?: string[];
    onlyPackages?: string[];
    addRootDir?: string;
    addEsmTsconfig?: string;
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
    options.onlyPackages = options.onlyPackages || [];
    options.indentation = options.indentation || 2;
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
    const onlyPackagesDeps = flatten(
        options.onlyPackages
            .map((x) => allPackages.find((y) => y.packageJSON.name === x))
            .map((x) => getDependencies(x.packageJSON).filter((k) => allPackages.find((x) => x.packageJSON.name === k)))
    );
    const errors = [];
    allPackages.forEach((packageInfo) => {
        // TODO add the package.json script
        // skip if not in  onlyPackages
        if (options.onlyPackages?.length) {
            const name = packageInfo.packageJSON.name;
            if (!options.onlyPackages.includes(name) && !onlyPackagesDeps.includes(name)) {
                return;
            }
        }

        const tsconfigFilePath =
            options.tsConfigPathFinder?.(packageInfo.location) ?? path.join(packageInfo.location, "tsconfig.json");

        if (!fs.existsSync(tsconfigFilePath)) {
            // Skip has not tsconfig.json
            return;
        }
        if (options.onlyOnPath && !isChildOf(path.resolve(packageInfo.location), path.resolve(options.onlyOnPath))) {
            return;
        }

        // NO MORE CHECKS ///////////////////////////////

        if (!options.checkOnly && options.addEsmTsconfig) {
            if ((options.addEsmTsconfig as any) === true) {
                options.addEsmTsconfig = "tsconfig.esm.json";
            }
            if (!existsSync(options.addEsmTsconfig)) {
                const esmTsconfig = JSON.stringify(
                    {
                        extends: "./tsconfig.json",
                        compilerOptions: {
                            module: "ESNext",
                            moduleResolution: "Node",
                            outDir: "./esm"
                        }
                    },
                    null,
                    options.indentation
                );
                writeFileSync(path.resolve(packageInfo.location, options.addEsmTsconfig), esmTsconfig);
            }
        }

        const tsconfigJSON = commentJSON.parse(fs.readFileSync(tsconfigFilePath, "utf-8"));
        const newTsconfigJSON = commentJSON.parse(commentJSON.stringify(tsconfigJSON), undefined, true);

        if (options.addComposite) {
            setCompilerOption(newTsconfigJSON, "composite", true);
        }

        if (options.addRootDir) {
            setCompilerOption(newTsconfigJSON, "rootDir", options.addRootDir);
        }

        if (options.addExtends) {
            newTsconfigJSON["extends"] = path.relative(
                path.resolve(packageInfo.location),
                path.resolve(options.addExtends)
            );
        }

        if (options.addInclude?.length) {
            if (!newTsconfigJSON["include"]) {
                newTsconfigJSON["include"] = [];
            }
            const includes: string[] = newTsconfigJSON["include"];
            options.addInclude.forEach((x) => {
                if (!includes.includes(x)) {
                    includes.push(x);
                }
            });
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
            // console.log(newTsconfigJSON, tsconfigJSON);
            try {
                assert.deepStrictEqual(pureObject(tsconfigJSON), pureObject(newTsconfigJSON));
            } catch (e) {
                // console.log("tsconfig different than expected");
                errors.push(e.message);
            }
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
    if (errors.length) {
        return {
            ok: false,
            errors
        };
    }
    return {
        ok: true
    };
};

function pureObject(x) {
    return JSON.parse(JSON.stringify(commentJSON.parse(commentJSON.stringify(x), undefined, true)));
}

function flatten(arr) {
    return arr.reduce(function (flat, toFlatten) {
        return flat.concat(Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten);
    }, []);
}

function setCompilerOption(newTsconfigJSON, k, v) {
    const compilerOptions = newTsconfigJSON["compilerOptions"];
    if (!compilerOptions) {
        newTsconfigJSON["compilerOptions"] = {};
    }
    newTsconfigJSON["compilerOptions"][k] = v;
}

function getDependencies(packageJSON) {
    return [...Object.keys(packageJSON.dependencies || {}), ...Object.keys(packageJSON.devDependencies || {})];
}

const isChildOf = (child: string, parent: string) => {
    if (child === parent) return false;
    const parentTokens = parent.split("/").filter((i) => i.length);
    const childTokens = child.split("/").filter((i) => i.length);
    return parentTokens.every((t, i) => childTokens[i] === t);
};
