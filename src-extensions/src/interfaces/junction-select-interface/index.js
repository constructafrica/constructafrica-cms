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

    console.log("DEBUG options: relations received:", relations);

    // For M2M relationships, we need to find the collection on the other side of the junction
    if (relations && relations.length >= 2) {
      // Find the junction collection (the one that's not the current collection)
      const junctionRelation = relations.find(
          (rel) => rel.collection !== rel.related_collection
      );

      console.log("DEBUG options: junction relation:", junctionRelation);

      if (junctionRelation) {
        const junctionCollection = junctionRelation.collection;

        // Find the relation from the junction to the target collection
        const targetRelation = relations.find(
            (rel) =>
                rel.collection === junctionCollection &&
                rel.related_collection !== relations[0].related_collection
        );

        console.log("DEBUG options: target relation:", targetRelation);

        if (targetRelation) {
          relatedCollection = targetRelation.related_collection;
        }
      }
    }

    console.log("DEBUG options: final relatedCollection:", relatedCollection);

    return [
      {
        field: "template",
        name: "$t:display_template",
        meta: {
          interface: "system-display-template",
          options: {
            collectionName: relatedCollection,
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