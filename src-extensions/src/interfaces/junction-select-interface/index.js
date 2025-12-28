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
  options: ({ relations }) => {
    let relatedCollection = null;

    // relations here is the result of getRelationsForField on the alias field
    if (relations && relations.length >= 2) {
      // Find the one pointing to something other than current collection
      const relatedRel = relations.find(
        (rel) =>
          rel.related_collection &&
          rel.related_collection !== relations[0].related_collection,
      );
      if (relatedRel) relatedCollection = relatedRel.related_collection;
    }

    return [
      {
        field: "template",
        name: "$t:display_template",
        meta: {
          interface: "system-display-template",
          options: {
            collectionName: relatedCollection, // Now passes e.g., 'countries' or 'types'
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
          options: { collectionName: relatedCollection },
          width: "full",
        },
      },
    ];
  },
  recommendedDisplays: ["related-values"],
});
