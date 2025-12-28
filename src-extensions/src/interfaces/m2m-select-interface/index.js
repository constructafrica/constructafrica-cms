import { defineInterface } from "@directus/extensions-sdk";
import InterfaceComponent from "./interface.vue";

export default defineInterface({
  id: "m2m-dropdown",
  name: "M2M Dropdown",
  description: "Searchable dropdown for Many-to-Many relationships",
  icon: "arrow_drop_down",
  component: InterfaceComponent,

  types: ["alias"],
  localTypes: ["m2m"],
  group: "relational",

  options: ({ relations }) => {
    const relation = relations.m2m;

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

  recommendedDisplays: ["related-values"],
});
