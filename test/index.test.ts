import path from "path";
import { toProjectReferences } from "../src";

describe("toProjectReferences", function () {
    it("support lerna.json", () => {
        const result = toProjectReferences({
            rootDir: path.join(__dirname, "fixtures/lerna"),
            checkOnly: true
        });
        expect(result.ok).toBe(true);
    });
    it("support yarn workspaces", () => {
        const result = toProjectReferences({
            rootDir: path.join(__dirname, "fixtures/yarn-workspaces"),
            checkOnly: true,
            addComposite: true
        });
        expect(result.ok).toBe(true);
    });
    it("ok: false when some package has self-dependency", () => {
        expect(() =>
            toProjectReferences({
                rootDir: path.join(__dirname, "fixtures/error.self-dependency"),
                checkOnly: true
            })
        ).toThrow();
    });
});
