/**
 * Swagger/OpenAPI configuration setup for the GK Server backend APIs.
 *
 * This file generates API documentation using swagger-jsdoc by defining:
 * - OpenAPI specification version
 * - API metadata (title, version, description)
 * - Server base URL
 * - Route files containing Swagger annotations/comments
 *
 * The generated swaggerSpec object is exported and used to serve
 * interactive API documentation through Swagger UI.
 */

const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",

    info: {
      title: "GK Server API",
      version: "1.0.0",
      description: "API documentation for Gurukul backend",
    },

    servers: [
      {
        url: "http://localhost:3000",
      },
    ],
  },

  // Path to files containing Swagger comments
  apis: ["./server/routes.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
