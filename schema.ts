/**
 * The parts of a formatter that preparing a schema uses, which a
 * `Formatter` from `@dprint/formatter` has.
 */
export interface SchemaFormatter {
  setConfig(globalConfig: Record<string, unknown>, pluginConfig: Record<string, unknown>): void;
  getConfigDiagnostics(): unknown[];
  formatText(request: { filePath: string; fileText: string }): string;
}

export interface PrepareSchemaOptions {
  /** The file extension of an example that doesn't specify one (ex. `"ts"`). */
  extension?: string;
}

/**
 * Code formatted with each value of a property, which dprint.dev shows in the
 * plugin's configuration documentation.
 *
 * It's declared on a property, or on the definition named after the property,
 * as `"x-example"`.
 */
export interface SchemaExample {
  /** The configuration to format the input with, besides the property. */
  config?: Record<string, unknown>;
  /** The file extension to format the input as (ex. `"tsx"`). */
  extension?: string;
  /** The lines of code to format. */
  input: string[];
  /**
   * The formatted input by value, where a value that isn't a string is in JSON
   * (ex. `"true"`). This is added by `prepareSchemaForPublish`.
   */
  outputs?: Record<string, string>;
}

interface SchemaDefinition {
  $ref?: string;
  default?: unknown;
  type?: string | string[];
  const?: unknown;
  oneOf?: SchemaDefinition[];
  enum?: unknown[];
  deprecationMessage?: string;
  deprecated?: boolean;
  "x-example"?: SchemaExample;
}

interface Schema {
  properties: Record<string, SchemaDefinition>;
  definitions?: Record<string, SchemaDefinition>;
  $defs?: Record<string, SchemaDefinition>;
}

/**
 * Prepares a plugin's config schema to be uploaded to a release.
 *
 * This adds the outputs of the schema's code examples (see `SchemaExample`)
 * and checks that the plugin accepts the default of every property in the
 * schema. It throws when that fails or an example formats the same with every
 * value of its property.
 */
export function prepareSchemaForPublish(
  schema: unknown,
  formatter: SchemaFormatter,
  options: PrepareSchemaOptions = {},
): void {
  const root = schema as Schema;
  const definitions = root.definitions ?? root.$defs ?? {};

  checkPropertiesAreAccepted();
  const errors: string[] = [];
  for (const [name, definition] of [...Object.entries(definitions), ...Object.entries(root.properties)]) {
    const example = definition["x-example"];
    if (example != null) {
      try {
        example.outputs = generateOutputs(name, example);
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  // ensures the schema doesn't have properties the plugin doesn't know about
  function checkPropertiesAreAccepted() {
    const config = Object.fromEntries(
      Object.entries(root.properties)
        .map(([name, property]) => [name, resolveRef(property).default])
        .filter(([_name, value]) => value !== undefined),
    );
    setConfig(config, "the property defaults");
  }

  function generateOutputs(propertyName: string, example: SchemaExample) {
    const property = root.properties[propertyName];
    if (property == null) {
      throw new Error(`An example is on "${propertyName}", which isn't a property.`);
    }
    const values = getValues(resolveRef(property));
    if (values.length < 2) {
      throw new Error(`The example of "${propertyName}" is on a property without multiple values.`);
    }
    const extension = example.extension ?? options.extension;
    if (extension == null) {
      throw new Error(`The example of "${propertyName}" needs an extension because there's no default extension.`);
    }

    const outputs: Record<string, string> = {};
    for (const value of values) {
      setConfig({ ...example.config, [propertyName]: value }, `the example of "${propertyName}"`);
      outputs[typeof value === "string" ? value : JSON.stringify(value)] = formatter.formatText({
        filePath: `example.${extension}`,
        fileText: example.input.join("\n") + "\n",
      });
    }
    if (new Set(Object.values(outputs)).size === 1) {
      throw new Error(`The example of "${propertyName}" formats the same with every value.`);
    }
    return outputs;
  }

  function getValues(definition: SchemaDefinition): unknown[] {
    if (definition.oneOf != null) {
      // deprecated values are aliases of other values, and an option that refers
      // to a definition (ex. a kind of sorting) has the values of that definition
      return definition.oneOf.flatMap((option) => {
        if (option.$ref != null) {
          return getValues(resolveRef(option));
        }
        const isDeprecated = option.deprecationMessage != null || option.deprecated === true;
        return !isDeprecated && option.const !== undefined ? [option.const] : [];
      });
    } else if (definition.enum != null) {
      return definition.enum;
    } else if (definition.type === "boolean") {
      return [true, false];
    } else {
      return [];
    }
  }

  function resolveRef(definition: SchemaDefinition): SchemaDefinition {
    if (definition.$ref == null) {
      return definition;
    }
    const { $ref, ...rest } = definition;
    const referenced = definitions[$ref.replace(/^#\/(definitions|\$defs)\//, "")];
    if (referenced == null) {
      throw new Error(`Could not find ${$ref}.`);
    }
    // a property may set its own values alongside the reference (ex. an example)
    return { ...referenced, ...rest };
  }

  function setConfig(config: Record<string, unknown>, description: string) {
    formatter.setConfig({}, config);
    const diagnostics = formatter.getConfigDiagnostics();
    if (diagnostics.length > 0) {
      throw new Error(`The plugin had diagnostics for ${description}:\n${JSON.stringify(diagnostics, undefined, 2)}`);
    }
  }
}
