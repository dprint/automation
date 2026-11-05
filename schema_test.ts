import { assertEquals, assertThrows } from "@std/assert";
import { prepareSchemaForPublish, type SchemaExample, type SchemaFormatter } from "./schema.ts";

Deno.test("adds the output of each value to the examples", () => {
  const semicolonsExample: SchemaExample = { input: ["a", "b"] };
  const useTabsExample: SchemaExample = { config: { lineWidth: 40 }, extension: "tsx", input: ["c"] };
  const schema = {
    definitions: {
      semicolons: {
        type: "string",
        default: "prefer",
        oneOf: [
          { const: "always" },
          { const: "semiColon", deprecationMessage: "Use \"always\" instead." },
          { const: "prefer" },
        ],
        "x-example": semicolonsExample,
      },
    },
    properties: {
      semicolons: { $ref: "#/definitions/semicolons" },
      useTabs: {
        type: "boolean",
        default: false,
        "x-example": useTabsExample,
      },
    },
  };

  prepareSchemaForPublish(schema, createFormatter(["semicolons", "useTabs", "lineWidth"]), { extension: "ts" });

  assertEquals(semicolonsExample, {
    input: ["a", "b"],
    outputs: {
      always: `example.ts {"semicolons":"always"}\na\nb\n`,
      prefer: `example.ts {"semicolons":"prefer"}\na\nb\n`,
    },
  });
  assertEquals(useTabsExample, {
    config: { lineWidth: 40 },
    extension: "tsx",
    input: ["c"],
    outputs: {
      true: `example.tsx {"lineWidth":40,"useTabs":true}\nc\n`,
      false: `example.tsx {"lineWidth":40,"useTabs":false}\nc\n`,
    },
  });
});

Deno.test("uses the values of an option that refers to a definition", () => {
  const example: SchemaExample = { input: ["a"] };
  const schema = {
    $defs: {
      kind: { oneOf: [{ const: "maintain" }, { const: "sort" }] },
    },
    properties: {
      sortNames: {
        default: "maintain",
        oneOf: [{ $ref: "#/$defs/kind" }, { type: "object" }],
        "x-example": example,
      },
    },
  };

  prepareSchemaForPublish(schema, createFormatter(["sortNames"]), { extension: "ts" });

  assertEquals(Object.keys(example.outputs!), ["maintain", "sort"]);
});

Deno.test("throws when the plugin doesn't accept a property", () => {
  const schema = {
    properties: {
      lineWidth: { type: "integer", default: 120 },
      oldName: { type: "boolean", default: false },
    },
  };

  assertThrows(
    () => prepareSchemaForPublish(schema, createFormatter(["lineWidth"])),
    Error,
    "The plugin had diagnostics for the property defaults",
  );
});

Deno.test("throws for each example that can't be generated", () => {
  const schema = {
    definitions: {
      notAProperty: { type: "boolean", "x-example": { extension: "ts", input: ["a"] } },
    },
    properties: {
      noExtension: { type: "boolean", "x-example": { input: ["a"] } },
      singleValue: { type: "integer", "x-example": { extension: "ts", input: ["a"] } },
      sameOutput: { type: "boolean", "x-example": { extension: "ts", input: ["a"] } },
    },
  };
  const formatter = createFormatter(["noExtension", "singleValue", "sameOutput", "notAProperty"]);
  const formatText = formatter.formatText;
  formatter.formatText = (request) => request.fileText.includes("a") ? "same" : formatText(request);

  assertThrows(
    () => prepareSchemaForPublish(schema, formatter),
    Error,
    [
      `An example is on "notAProperty", which isn't a property.`,
      `The example of "noExtension" needs an extension because there's no default extension.`,
      `The example of "singleValue" is on a property without multiple values.`,
      `The example of "sameOutput" formats the same with every value.`,
    ].join("\n"),
  );
});

Deno.test("allows sections with every top level property", () => {
  const schema = {
    "x-sections": [
      { title: "General", properties: ["lineWidth"] },
      { title: "Spaces", properties: ["memberSpacing"] },
    ],
    definitions: { memberSpacing: { type: "string" } },
    properties: {
      $schema: { type: "string" },
      lineWidth: { type: "integer" },
      memberSpacing: { $ref: "#/definitions/memberSpacing" },
      // shown under `memberSpacing`
      "classDeclaration.memberSpacing": { $ref: "#/definitions/memberSpacing" },
    },
  };

  prepareSchemaForPublish(schema, createFormatter(["lineWidth", "memberSpacing", "classDeclaration.memberSpacing"]));
});

Deno.test("throws when a top level property isn't in exactly one section", () => {
  const schema = {
    "x-sections": [
      { title: "General", properties: ["lineWidth", "missing", "classDeclaration.memberSpacing"] },
      { title: "Spaces", properties: ["lineWidth"] },
    ],
    definitions: { memberSpacing: { type: "string" } },
    properties: {
      lineWidth: { type: "integer" },
      useTabs: { type: "boolean" },
      memberSpacing: { $ref: "#/definitions/memberSpacing" },
      "classDeclaration.memberSpacing": { $ref: "#/definitions/memberSpacing" },
    },
  };
  const formatter = createFormatter(["lineWidth", "useTabs", "memberSpacing", "classDeclaration.memberSpacing"]);

  assertThrows(
    () => prepareSchemaForPublish(schema, formatter),
    Error,
    [
      `The "General" section has "missing", which isn't a property.`,
      `The "General" section has "classDeclaration.memberSpacing", which is shown under "memberSpacing".`,
      `The "Spaces" section has "lineWidth", which is already in the "General" section.`,
      `"useTabs" isn't in a section.`,
      `"memberSpacing" isn't in a section.`,
    ].join("\n"),
  );
});

Deno.test("allows overrides that match the plugin and listing them in a section", () => {
  const schema = {
    "x-sections": [{ title: "General", properties: ["bracePosition", "jsx.bracePosition"] }],
    definitions: { bracePosition: { type: "string", enum: ["sameLine", "nextLine"] } },
    properties: {
      bracePosition: { $ref: "#/definitions/bracePosition" },
      // shown on its own because it's listed
      "jsx.bracePosition": { $ref: "#/definitions/bracePosition", "x-overrides": "bracePosition" },
      // shown under `bracePosition`
      "classDeclaration.bracePosition": { $ref: "#/definitions/bracePosition", "x-overrides": "bracePosition" },
    },
  };
  const properties = ["bracePosition", "jsx.bracePosition", "classDeclaration.bracePosition"];
  const overrides = { "jsx.bracePosition": "bracePosition", "classDeclaration.bracePosition": "bracePosition" };

  prepareSchemaForPublish(schema, createFormatter(properties, overrides));
});

Deno.test("throws when the overrides don't match the plugin", () => {
  const schema = {
    "x-sections": [{ title: "General", properties: ["bracePosition", "useTabs", "quoteStyle"] }],
    properties: {
      bracePosition: { type: "string", enum: ["sameLine", "nextLine"] },
      useTabs: { type: "boolean" },
      quoteStyle: { type: "string", enum: ["single", "double"] },
      // missing its "x-overrides"
      "classDeclaration.bracePosition": { type: "string", enum: ["sameLine", "nextLine"] },
      // overrides the wrong property
      "jsx.quoteStyle": { type: "string", enum: ["single", "double"], "x-overrides": "useTabs" },
      "jsx.other": { type: "boolean", "x-overrides": "missing" },
    },
  };
  const properties = ["bracePosition", "useTabs", "quoteStyle", "classDeclaration.bracePosition", "jsx.quoteStyle"];
  const overrides = { "classDeclaration.bracePosition": "bracePosition", "jsx.quoteStyle": "quoteStyle" };

  assertThrows(
    () => prepareSchemaForPublish(schema, createFormatter([...properties, "jsx.other"], overrides)),
    Error,
    `"jsx.other" overrides "missing", which isn't a property.`,
  );

  delete (schema.properties as Record<string, unknown>)["jsx.other"];
  assertThrows(
    () => prepareSchemaForPublish(schema, createFormatter(properties, overrides)),
    Error,
    [
      `Setting "bracePosition" changes "classDeclaration.bracePosition", so "classDeclaration.bracePosition" should have "x-overrides": "bracePosition".`,
      `"jsx.quoteStyle" overrides "useTabs", but setting "useTabs" doesn't change it.`,
      `Setting "quoteStyle" changes "jsx.quoteStyle", so "jsx.quoteStyle" should have "x-overrides": "quoteStyle".`,
      `"classDeclaration.bracePosition" isn't in a section.`,
    ].join("\n"),
  );
});

// creates a formatter that accepts the given properties and outputs the file
// path and config before the text, where a property in `overrides` resolves to
// the value of the property it overrides when it isn't set
function createFormatter(propertyNames: string[], overrides: Record<string, string> = {}): SchemaFormatter {
  let config: Record<string, unknown> = {};
  return {
    setConfig(_globalConfig, pluginConfig) {
      config = pluginConfig;
    },
    getConfigDiagnostics() {
      return Object.keys(config)
        .filter((name) => !propertyNames.includes(name))
        .map((name) => ({ propertyName: name, message: "Unknown property." }));
    },
    getResolvedConfig() {
      return Object.fromEntries(propertyNames.map((name) => {
        const overridden = overrides[name];
        return [name, config[name] ?? (overridden == null ? null : config[overridden] ?? null)];
      }));
    },
    formatText(request) {
      return `${request.filePath} ${JSON.stringify(config)}\n${request.fileText}`;
    },
  };
}
