# Real 3D car models (optional)

By default every car is generated in code (`js/car.js`). To show a real, photo-accurate model
for a team instead:

1. Get a `.glb` file of the car. Sketchfab (sketchfab.com) has many F1 models: search for the
   car, tick **Downloadable**, and check the licence allows use on your site (CC-BY usually
   means you must credit the author on the page). Download it in **glTF Binary (.glb)** format.
2. Keep it small: under ~10 MB loads well. https://gltf.report can compress a model.
3. Save it here, e.g. `site/models/red_bull.glb`.
4. In `js/car.js`, add the team to `MODEL_FILES`:

   ```js
   export const MODEL_FILES = {
     red_bull: { url: 'models/red_bull.glb', rotationY: 0, length: 5.4 },
   };
   ```

   `rotationY` turns the model so its nose points the same way as the built-in car
   (try `Math.PI / 2` or `-Math.PI / 2` if it faces sideways). `length` is the car's length in metres.

If the file is missing or fails to load, the site falls back to the generated car.
