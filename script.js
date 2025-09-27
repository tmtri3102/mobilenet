// --- CONFIGURATION ---
const BACKEND_URL = "https://western-ping-entered-drilling.trycloudflare.com"; // IMPORTANT: Change this!

// --- DOM ELEMENTS ---
const showCreateBtn = document.getElementById("show-create-btn");
const detectBtn = document.getElementById("detect-btn");
const createSection = document.getElementById("create-section");
const detectionSection = document.getElementById("detection-section");
const imageUpload = document.getElementById("image-upload");
const createBtn = document.getElementById("create-btn");
const videoFeed = document.getElementById("video-feed");
const stopDetectionBtn = document.getElementById("stop-detection-btn");
const loadingIndicator = document.getElementById("loading-indicator");
const detectionResult = document.getElementById("detection-result");
const mainControls = document.getElementById("main-controls");

// --- GLOBAL VARIABLES ---
let model;
let savedObjects = [];
let isDetecting = false;
let stream;

// --- INITIALIZATION ---
async function loadModel() {
  loadingIndicator.classList.remove("hidden");
  console.log("Loading MobileNet model...");
  model = await mobilenet.load();
  console.log("Model loaded successfully.");
  loadingIndicator.classList.add("hidden");
}
loadModel(); // Load the model as soon as the app starts

// --- UI EVENT LISTENERS ---
showCreateBtn.addEventListener("click", () => {
  createSection.classList.remove("hidden");
  detectionSection.classList.add("hidden");
  mainControls.classList.add("hidden");
  stopDetection();
});

detectBtn.addEventListener("click", async () => {
  if (!model) {
    alert("AI Model is still loading, please wait.");
    return;
  }
  createSection.classList.add("hidden");
  detectionSection.classList.remove("hidden");
  mainControls.classList.add("hidden");
  await fetchSavedObjects(); // Get the latest data from the server
  startDetection();
});

stopDetectionBtn.addEventListener("click", () => {
  stopDetection();
  detectionSection.classList.add("hidden");
  mainControls.classList.remove("hidden");
});

imageUpload.addEventListener("change", () => {
  createBtn.disabled = imageUpload.files.length === 0;
  // Show image previews
  const previewContainer = document.getElementById("preview-container");
  previewContainer.innerHTML = "";
  for (const file of imageUpload.files) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement("img");
      img.src = e.target.result;
      previewContainer.appendChild(img);
    };
    reader.readAsDataURL(file);
  }
});

createBtn.addEventListener("click", handleCreateObject);

// --- CORE FUNCTIONS ---

/**
 * Gets Geolocation and handles object creation process
 */
async function handleCreateObject() {
  createBtn.disabled = true;
  createBtn.textContent = "Processing...";

  // Log the URL we are about to call for debugging
  console.log(
    `Attempting to connect to backend at: ${BACKEND_URL}/api/objects`
  );

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      // ... (the rest of the function for generating features is the same)
      const features = [];
      for (const file of imageUpload.files) {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise((resolve) => (img.onload = resolve));
        const featureVector = await getFeatureVector(img);
        features.push(Array.from(featureVector.dataSync()));
      }

      const formData = new FormData();
      formData.append("name", document.getElementById("object-name").value);
      formData.append(
        "description",
        document.getElementById("object-description").value
      );
      formData.append("location", JSON.stringify(location));
      formData.append("features", JSON.stringify(features));
      for (const file of imageUpload.files) {
        formData.append("images", file);
      }

      try {
        const response = await fetch(`${BACKEND_URL}/api/objects`, {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          alert("Object created successfully!");
          resetCreateForm();
        } else {
          // Get more details from a failed server response
          const errorText = await response.text();
          console.error(
            "Server responded with an error:",
            response.status,
            errorText
          );
          alert(
            `Failed to create object. Server said: ${response.status} - ${errorText}`
          );
        }
      } catch (error) {
        // This is the block for a total connection failure
        console.error(
          "**Fetch Error:** Could not connect to the server.",
          error
        );
        alert(
          `Error connecting to the server. Please check the console for details. Message: ${error.message}`
        );
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = "Create Object";
      }
    },
    (error) => {
      alert("Could not get geolocation. Please enable location services.");
      console.error("Geolocation error:", error);
      createBtn.disabled = false;
      createBtn.textContent = "Create Object";
    }
  );
}

/**
 * Fetches all saved object data from the backend
 */
async function fetchSavedObjects() {
  console.log(`Attempting to fetch objects from: ${BACKEND_URL}/api/objects`);
  try {
    const response = await fetch(`${BACKEND_URL}/api/objects`);
    if (!response.ok) {
      // Handle server errors (like 404 or 500)
      const errorText = await response.text();
      console.error(
        "Server responded with an error:",
        response.status,
        errorText
      );
      alert(`Could not get object data. Server said: ${response.status}`);
      return; // Stop execution
    }
    savedObjects = await response.json();
    console.log("Fetched and saved objects:", savedObjects);
  } catch (error) {
    // Handle network/connection errors
    console.error("**Fetch Error:** Could not connect to the server.", error);
    alert(
      `Could not connect to the server to get object data. Please check the console. Message: ${error.message}`
    );
  }
}

/**
 * Starts the camera and the detection loop
 */
async function startDetection() {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      videoFeed.srcObject = stream;
      isDetecting = true;
      detectionLoop();
    } catch (error) {
      console.error("Error accessing camera:", error);
      alert("Could not access the camera. Please grant permission.");
    }
  }
}

/**
 * Stops the camera stream
 */
function stopDetection() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  isDetecting = false;
  videoFeed.srcObject = null;
  detectionResult.textContent = "";
}

/**
 * The main loop that grabs frames and tries to find a match
 */
async function detectionLoop() {
  if (isDetecting && model && savedObjects.length > 0) {
    // NEW CHECK: Wait until the video is ready and has a valid size
    if (videoFeed.readyState < 3 || videoFeed.videoWidth === 0) {
      console.log("Video not ready yet, waiting for the next frame...");
      requestAnimationFrame(detectionLoop); // Try again on the next frame
      return; // Exit this function call
    }

    console.log(
      `Detection loop running... Comparing against ${savedObjects.length} saved objects.`
    );

    const currentFeatures = await getFeatureVector(videoFeed);

    let bestMatch = { id: null, name: null, score: 0.4 };

    for (const obj of savedObjects) {
      for (const savedFeature of obj.features) {
        const savedTensor = tf.tensor(savedFeature);
        const similarity = cosineSimilarity(currentFeatures, savedTensor);
        console.log(`- Similarity with ${obj.name}: ${similarity.toFixed(4)}`);
        if (similarity > bestMatch.score) {
          bestMatch = { id: obj.id, name: obj.name, score: similarity };
        }
      }
    }

    if (bestMatch.id) {
      detectionResult.textContent = `Detected: ${
        bestMatch.name
      } (Confidence: ${Math.round(bestMatch.score * 100)}%)`;
    } else {
      detectionResult.textContent = `Scanning... (Highest similarity: ${Math.round(
        bestMatch.score * 100
      )}%)`;
    }

    currentFeatures.dispose();
    requestAnimationFrame(detectionLoop);
  }
}

// --- AI HELPER FUNCTIONS ---

/**
 * Takes an image or video element and returns its feature vector using MobileNet
 * @param {HTMLImageElement|HTMLVideoElement} imgElement
 * @returns {tf.Tensor} A 1D tensor representing the image features
 */
function getFeatureVector(imgElement) {
  return tf.tidy(() => {
    const tensor = tf.browser.fromPixels(imgElement);
    const resized = tf.image.resizeBilinear(tensor, [224, 224]);
    const expanded = resized.expandDims(0);
    const preprocessed = expanded
      .toFloat()
      .div(tf.scalar(127))
      .sub(tf.scalar(1));
    const features = model.infer(preprocessed, "conv_preds");
    return features.squeeze();
  });
}

/**
 * Calculates the cosine similarity between two tensors
 * @param {tf.Tensor} tensorA
 * @param {tf.Tensor} tensorB
 * @returns {number} Similarity score between 0 and 1
 */
function cosineSimilarity(tensorA, tensorB) {
  const dotProduct = tensorA.dot(tensorB).dataSync()[0];
  const normA = tensorA.norm().dataSync()[0];
  const normB = tensorB.norm().dataSync()[0];
  return dotProduct / (normA * normB);
}

// --- UTILITY FUNCTIONS ---
function resetCreateForm() {
  document.getElementById("object-name").value = "";
  document.getElementById("object-description").value = "";
  imageUpload.value = "";
  document.getElementById("preview-container").innerHTML = "";
  createSection.classList.add("hidden");
  mainControls.classList.remove("hidden");
}
