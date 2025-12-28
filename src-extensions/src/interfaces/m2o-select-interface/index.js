import { defineInterface } from "@directus/extensions-sdk";
import InterfaceComponent from "./interface.vue";

export default defineInterface({
  id: "m2o-dropdown",
  name: "M2O Dropdown",
  description: "Searchable dropdown for Many-to-One relationships",
  icon: "arrow_drop_down",
  component: InterfaceComponent,
  types: ["string", "uuid", "integer"],
  localTypes: ["m2o"],
  group: "relational",

  options: ({ relations }) => {
    const relation = relations.m2o;

    return [
      {
        field: "template",
        name: "$t:display_template",
        meta: {
          interface: "system-display-template",
          options: {
            collectionName: relation?.related_collection,
          },
          width: "full",
        },
      },
      {
        field: "enableCreate",
        name: "Enable Create",
        type: "boolean",
        meta: {
          interface: "boolean",
          options: {
            label: "Allow creating new items",
          },
          width: "half",
        },
        schema: {
          default_value: false,
        },
      },
      {
        field: "filter",
        name: "$t:filter",
        type: "json",
        meta: {
          interface: "system-filter",
          options: {
            collectionName: relation?.related_collection,
          },
          width: "full",
        },
      },
    ];
  },

  recommendedDisplays: ["related-value"],
});
