import { promises as fs } from 'fs';
import * as path from 'path';
import { generateApi, generateTemplates } from 'swagger-typescript-api';

export interface GenerateModelOptions {
  fileName: string;
  swaggerFile: string;
  ouputDir: string;
  callback?: () => void;
}

export const generateModelFromSwagger = async ({
  fileName,
  swaggerFile,
  ouputDir,
  callback
}: GenerateModelOptions) => {
  try {
    const { files } = await generateApi({
      name: `${fileName}.ts`,
      output: path.resolve(process.cwd(), ouputDir),
      input: swaggerFile,
      defaultResponseAsSuccess: true,
      generateClient: false,
      generateRouteTypes: true,
      toJS: false,
      silent: true,
      prettier: {
        printWidth: 120,
        tabWidth: 2,
        trailingComma: "all",
        parser: "typescript",
      },
      modular: false,
      singleHttpClient: false,
      cleanOutput: true,
      enumNamesAsValues: true,
      generateUnionEnums: true,
      addReadonly: false,
      sortTypes: true,
      sortRouters: true,
      extractingOptions: {
        requestBodySuffix: ["Payload"],
        requestParamsSuffix: ["Params"],
        responseBodySuffix: [
          "Data",
          "Result",
          "Output",
          "data",
          "Response",
          "ResponseData",
        ],
        responseErrorSuffix: [
          "Error",
          "Fail",
          "Fails",
          "ErrorData",
          "HttpError",
          "BadResponse",
        ],
      },
      extraTemplates: [],
      anotherArrayType: false,
      fixInvalidTypeNamePrefix: "Type",
      fixInvalidEnumKeyPrefix: "Value",
      patchInvalidOpId: true,
      patch: true,

      hooks: {
        

        onFormatTypeName: (typeName, _rawTypeName, _schemaType) => {
          return typeName;
        },
        // @ts-expect-error
        onPreParseSchema: (originalSchema: unknown, _typeName: string, _schemaType: string) => {
            if ((originalSchema as any)?.description) {
              delete (originalSchema as any).description;
            }
          
          if ((originalSchema as any)?.example) {
            // delete
            delete (originalSchema as any).example;
          }

          if ((originalSchema as any)?.format) {
            delete (originalSchema as any).format;
          }

          if ((originalSchema as any)?.maxLength) {
            delete (originalSchema as any).maxLength;
          }

          return originalSchema;
        },
        onParseSchema: (_, parsedSchema: unknown) => {
          if ((parsedSchema as any)?.example) {
            delete (parsedSchema as any).example;
          }

          return parsedSchema;
        },
        // onPrepareConfig: (currentConfiguration) => {},
      },
    });
// @ts-expect-error
    for (const { content, name } of files) {
      const filePath = path.resolve(process.cwd(), ouputDir, name);
      try {
        console.log(content);
        await fs.writeFile(filePath, content);
      } catch (error) {
        console.error(`Error writing file ${filePath}:`, error);
      }
    }
    
    if (callback && typeof callback === "function") {
      callback();
    }

    return files;
  } catch (e) {
    return null;
  }
};

export const generateTemplate = (dir: string) =>
  generateTemplates({
    cleanOutput: true,
    output: dir,
    httpClientType: "fetch",
    modular: false,
    silent: true,
  });

