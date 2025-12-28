import { defineInterface } from "@directus/extensions-sdk";
import InterfaceComponent from "./interface.vue";

export default defineInterface({
  id: "junction-dropdown",
  name: "Junction M2M Dropdown",
  description:
    "Searchable dropdown for Many-to-Many relationships via junction table",
  icon: "link",
  component: InterfaceComponent,
  types: ["alias"],
  localTypes: ["m2m"],
  group: "relational",
  options: [
    {
      field: "template",
      name: "$t:display_template",
      type: "string",
      meta: {
        interface: "system-display-template",
        options: {
          collectionName: "relatedCollection", // special placeholder
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
        options: { label: "Allow creating new items in related collection" },
        width: "half",
      },
      schema: { default_value: false },
    },
    {
      field: "filter",
      name: "$t:filter",
      type: "json",
      meta: {
        interface: "system-filter",
        options: { collectionName: "relatedCollection" },
        width: "full",
      },
    },
  ],
  recommendedDisplays: ["related-values"],
});
