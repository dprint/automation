/**
 * The parts of a formatter that preparing a schema uses, which a
 * `Formatter` from `@dprint/formatter` has.
 */
export interface SchemaFormatter {
  setConfig(globalConfig: Record<string, unknown>, pluginConfig: Record<string, unknown>): void;
  getConfigDiagnostics(): unknown[];
  getResolvedConfig(): Record<string, unknown>;
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
  /**
   * The file extension to format the input as (ex. `"tsx"`). When it isn't
   * specified, `prepareSchemaForPublish` sets it to the default extension, so
   * dprint.dev knows the language to highlight the code as.
   */
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
  /**
   * The property this property overrides for one kind of node, which it
   * defaults to the value of (ex. `"bracePosition"` on
   * `classDeclaration.bracePosition`).
   */
  "x-overrides"?: string;
}

interface Schema {
  properties: Record<string, SchemaDefinition>;
  definitions?: Record<string, SchemaDefinition>;
  $defs?: Record<string, SchemaDefinition>;
  "x-sections"?: SchemaSection[];
  "x-playground"?: SchemaPlayground;
}

/**
 * The code the dprint.dev playground starts with when the plugin is selected,
 * which is declared in the schema's `"x-playground"`. It's best when the code
 * isn't formatted, so the playground shows what formatting does.
 */
export interface SchemaPlayground {
  /**
   * The file extension of the code (ex. `"tsx"`). When it isn't specified,
   * `prepareSchemaForPublish` sets it to the default extension.
   */
  extension?: string;
  /** The lines of code. */
  input: string[];
}

// the most characters of a playground's code
const MAX_PLAYGROUND_LENGTH = 20_000;

/**
 * A section of the plugin's configuration documentation on dprint.dev, which is
 * declared in the schema's `"x-sections"`.
 */
export interface SchemaSection {
  title: string;
  description?: string;
  /**
   * The properties in the section, in order.
   *
   * A property with an `"x-overrides"` that isn't listed is shown under the
   * property it overrides instead. When the schema doesn't use
   * `"x-overrides"`, a property that refers to another property's definition
   * or whose last segment is another property's name (ex.
   * `classExpression.memberSpacing` with `memberSpacing`) is shown under that
   * property and can't be listed.
   */
  properties: string[];
}

// properties every plugin schema may have that aren't plugin configuration
const IGNORED_PROPERTY_NAMES = new Set(["$schema", "deno", "locked"]);

/**
 * Prepares a plugin's config schema to be uploaded to a release.
 *
 * This adds the outputs of the schema's code examples (see `SchemaExample`)
 * and checks that the plugin accepts the default of every property in the
 * schema. It throws when that fails, an example formats the same with every
 * value of its property, or the schema has sections (see `SchemaSection`) and
 * a top level property isn't in exactly one of them.
 *
 * When the schema uses `"x-overrides"`, it also throws when the plugin doesn't
 * match them, which is when setting a property with a fixed set of values
 * changes another property without an `"x-overrides"` of it, or doesn't
 * change a property that has one.
 */
export function prepareSchemaForPublish(
  schema: unknown,
  formatter: SchemaFormatter,
  options: PrepareSchemaOptions = {},
): void {
  const root = schema as Schema;
  const definitions = root.definitions ?? root.$defs ?? {};
  const usesOverrides = Object.values(root.properties).some((property) => property["x-overrides"] != null);

  checkPropertiesAreAccepted();
  const errors: string[] = [...getOverrideErrors(), ...getSectionErrors(), ...getPlaygroundErrors()];
  for (const [name, definition] of [...Object.entries(definitions), ...Object.entries(root.properties)]) {
    const example = definition["x-example"];
    if (example != null) {
      try {
        example.outputs = generateOutputs(name, example);
        example.extension ??= options.extension;
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

  function getOverrideErrors() {
    if (!usesOverrides) {
      return [];
    }
    const errors: string[] = [];
    for (const [name, property] of Object.entries(root.properties)) {
      const overridden = property["x-overrides"];
      if (overridden == null) {
        continue;
      }
      const overriddenProperty = root.properties[overridden];
      if (overriddenProperty == null || IGNORED_PROPERTY_NAMES.has(overridden)) {
        errors.push(`"${name}" overrides "${overridden}", which isn't a property.`);
      } else if (overriddenProperty["x-overrides"] != null) {
        errors.push(`"${name}" overrides "${overridden}", which overrides "${overriddenProperty["x-overrides"]}".`);
      }
    }
    if (errors.length > 0) {
      return errors;
    }

    // compares the overrides to the properties the plugin changes when each
    // property that isn't an override is set to each of its values
    setConfig({}, "no configuration");
    const defaultConfig = formatter.getResolvedConfig();
    const changedBy = new Map<string, Set<string>>();
    const checkedProperties = new Set<string>();
    for (const [name, property] of Object.entries(root.properties)) {
      if (IGNORED_PROPERTY_NAMES.has(name) || property["x-overrides"] != null) {
        continue;
      }
      const values = getValues(resolveRef(property));
      if (values.length > 0) {
        checkedProperties.add(name);
      }
      for (const value of values) {
        setConfig({ [name]: value }, `"${name}" set to ${JSON.stringify(value)}`);
        for (const [key, resolvedValue] of Object.entries(formatter.getResolvedConfig())) {
          const isChanged = JSON.stringify(resolvedValue) !== JSON.stringify(defaultConfig[key]);
          if (key !== name && key in root.properties && isChanged) {
            changedBy.set(key, (changedBy.get(key) ?? new Set()).add(name));
          }
        }
      }
    }
    for (const [name, property] of Object.entries(root.properties)) {
      const overridden = property["x-overrides"];
      const changers = changedBy.get(name) ?? new Set();
      // a property the plugin doesn't resolve can't be checked
      if (
        overridden != null && checkedProperties.has(overridden) && name in defaultConfig && !changers.has(overridden)
      ) {
        errors.push(`"${name}" overrides "${overridden}", but setting "${overridden}" doesn't change it.`);
      }
      for (const changer of changers) {
        if (changer !== overridden) {
          errors.push(`Setting "${changer}" changes "${name}", so "${name}" should have "x-overrides": "${changer}".`);
        }
      }
    }
    return errors;
  }

  function getSectionErrors() {
    const sections = root["x-sections"];
    if (sections == null) {
      return [];
    }
    const errors: string[] = [];
    const sectionByProperty = new Map<string, string>();
    for (const section of sections) {
      for (const name of section.properties) {
        const property = root.properties[name];
        // an override that's listed is shown on its own, but without overrides
        // the property dprint.dev guesses it's under always shows it
        const parentName = property == null || usesOverrides ? undefined : getParentPropertyName(name, property);
        const otherSection = sectionByProperty.get(name);
        if (property == null || IGNORED_PROPERTY_NAMES.has(name)) {
          errors.push(`The "${section.title}" section has "${name}", which isn't a property.`);
        } else if (parentName != null) {
          errors.push(`The "${section.title}" section has "${name}", which is shown under "${parentName}".`);
        } else if (otherSection != null) {
          errors.push(
            `The "${section.title}" section has "${name}", which is already in the "${otherSection}" section.`,
          );
        } else {
          sectionByProperty.set(name, section.title);
        }
      }
    }
    for (const [name, property] of Object.entries(root.properties)) {
      const isTopLevel = !IGNORED_PROPERTY_NAMES.has(name) && getParentPropertyName(name, property) == null;
      if (isTopLevel && !sectionByProperty.has(name)) {
        errors.push(`"${name}" isn't in a section.`);
      }
    }
    return errors;
  }

  // gets the property that dprint.dev shows a property under when it isn't
  // listed in a section, which is the property it overrides or, when the schema
  // doesn't use overrides, the property whose definition it refers to or whose
  // name is its last segment (ex. `classExpression.memberSpacing` is shown
  // under `memberSpacing`)
  function getParentPropertyName(name: string, property: SchemaDefinition) {
    if (usesOverrides) {
      return property["x-overrides"];
    }
    if (property.$ref == null) {
      return undefined;
    }
    const derivedName = property.$ref.replace(/^#\/(definitions|\$defs)\//, "");
    const lastSegment = name.split(".").pop()!;
    if (derivedName !== name && derivedName in root.properties) {
      return derivedName;
    } else if (lastSegment !== name && lastSegment in root.properties) {
      return lastSegment;
    } else {
      return undefined;
    }
  }

  // checks the playground's code formats and is changed by formatting, so it
  // shows what the plugin does, and sets its extension
  function getPlaygroundErrors() {
    const playground = root["x-playground"];
    if (playground == null) {
      return [];
    }
    if (!Array.isArray(playground.input) || playground.input.some((line) => typeof line !== "string")) {
      return [`The playground's input isn't an array of lines.`];
    }
    const text = playground.input.join("\n") + "\n";
    if (text.length > MAX_PLAYGROUND_LENGTH) {
      return [`The playground's input is over ${MAX_PLAYGROUND_LENGTH} characters.`];
    }
    const extension = playground.extension ?? options.extension;
    if (extension == null) {
      return [`The playground needs an extension because there's no default extension.`];
    }
    try {
      setConfig({}, "the playground");
      const output = formatter.formatText({ filePath: `playground.${extension}`, fileText: text });
      if (output === text) {
        return [`The playground's input is already formatted, so it doesn't show what formatting does.`];
      }
    } catch (err) {
      return [`The playground's input failed to format: ${(err as Error).message}`];
    }
    playground.extension = extension;
    return [];
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
