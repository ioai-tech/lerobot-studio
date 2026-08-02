/**
 * Formats LeRobot path templates from `meta/info.json`.
 *
 * LeRobot uses Python format fields such as `{chunk_index:03d}` and, for
 * v2.x, `{episode_chunk:03d}`. Keeping this logic in one place prevents
 * readers and writers from silently drifting to hard-coded default layouts.
 */
export interface LeRobotPathVariables {
  chunk_index?: number;
  file_index?: number;
  episode_chunk?: number;
  episode_index?: number;
  video_key?: string;
}

const FIELD_PATTERN = /\{([a-z_]+)(?::0?(\d+)d)?\}/g;

export function formatLeRobotPath(template: string, variables: LeRobotPathVariables): string {
  return template.replace(
    FIELD_PATTERN,
    (_field, name: keyof LeRobotPathVariables, width?: string) => {
      const value = variables[name];
      if (value === undefined || value === null) {
        throw new Error(
          `LeRobot path template requires "${name}", but no value was provided: ${template}`,
        );
      }

      if (width !== undefined) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          throw new Error(
            `LeRobot path template field "${name}" must be a non-negative integer: ${template}`,
          );
        }
        return String(value).padStart(Number(width), '0');
      }

      return String(value);
    },
  );
}
