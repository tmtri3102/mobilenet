// --- CONFIGURATION ---
const BACKEND_URL = "https://western-ping-entered-drilling.trycloudflare.com"; // IMPORTANT: Change this!

// --- DOM ELEMENTS (get references to all HTML elements we need) ---
const showCreateBtn = document.getElementById("show-create-btn");
const detectBtn = document.getElementById("detect-btn");
const createSection = document.getElementById("create-section");
const detectionSection = document.getElementById("detection-section");
const mainControls = document.getElementById("main-controls");
const loadingIndicator = document.getElementById("loading-indicator");

// Create Section Elements
const imageUpload = document.getElementById("image-upload");
const createBtn = document.getElementById("create-btn");

// Detection Section Elements
const captureInput = document.getElementById("capture-input");
const captureBtn = document.getElementById("capture-btn");
const imagePreview = document.getElementById("image-preview");
const startDetectionBtn = document.getElementById("start-detection-btn");

// Popup Elements
const popupContainer = document.getElementById("popup-container");
const popupCloseBtn = document.getElementById("popup-close-btn");

// --- GLOBAL VARIABLES ---
let model; // To hold the loaded MobileNet model
let savedObjects = []; // To hold object data fetched from the server

// --- INITIALIZATION ---
// Load the AI model as soon as the app starts
async function loadModel() {
  loadingIndicator.classList.remove("hidden");
  console.log("Loading MobileNet model...");
  model = await mobilenet.load();
  console.log("Model loaded successfully.");
  loadingIndicator.classList.add("hidden");
}
loadModel();

// --- UI EVENT LISTENERS ---
// Show the 'Create New Object' section
showCreateBtn.addEventListener("click", () => {
  createSection.classList.remove("hidden");
  detectionSection.classList.add("hidden");
  mainControls.classList.add("hidden");
});

// Show the 'Detect Object' section
detectBtn.addEventListener("click", () => {
  fetchSavedObjects(); // Fetch latest objects from server
  createSection.classList.add("hidden");
  detectionSection.classList.remove("hidden");
  mainControls.classList.add("hidden");
  // Reset the UI from any previous detection
  imagePreview.classList.add("hidden");
  startDetectionBtn.classList.add("hidden");
  document.getElementById("results-list").innerHTML = "";
  document.getElementById("results-title").textContent = "";
});

// CREATE SECTION: Enable 'Create' button only after files are selected
imageUpload.addEventListener("change", () => {
  createBtn.disabled = imageUpload.files.length === 0;
  const previewContainer = document.getElementById("preview-container");
  previewContainer.innerHTML = ""; // Clear old previews
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

// CREATE SECTION: Handle the creation of a new object
createBtn.addEventListener("click", handleCreateObject);

// DETECT SECTION: Trigger hidden file input when "Take Picture" is clicked
captureBtn.addEventListener("click", () => captureInput.click());

// DETECT SECTION: When a picture is taken, show a preview and the 'Detect' button
captureInput.addEventListener("change", () => {
  const file = captureInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.src = e.target.result;
      imagePreview.classList.remove("hidden");
      startDetectionBtn.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }
});

// DETECT SECTION: Start the analysis when the 'Detect' button is clicked
startDetectionBtn.addEventListener("click", analyzeCapturedImage);

// POPUP: Close the popup when the close button is clicked
popupCloseBtn.addEventListener("click", () => {
  popupContainer.classList.add("hidden");
});

// --- CORE FUNCTIONS ---
/**
 * Handles the entire process of creating a new object and sending it to the server.
 */
async function handleCreateObject() {
  createBtn.disabled = true;
  createBtn.textContent = "Processing...";

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      // Generate feature vectors for each uploaded image
      const features = [];
      for (const file of imageUpload.files) {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise((resolve) => (img.onload = resolve));
        const featureVector = await getFeatureVector(img);
        features.push(Array.from(featureVector.dataSync()));
      }

      // Prepare form data to send to the backend
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
          alert("Failed to create object.");
        }
      } catch (error) {
        console.error("Error creating object:", error);
        alert("Error connecting to the server.");
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
 * Fetches all saved object data from the backend.
 */
async function fetchSavedObjects() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/objects`);
    savedObjects = await response.json();
    console.log("Fetched saved objects:", savedObjects);
  } catch (error) {
    console.error("Could not fetch saved objects:", error);
    alert("Could not connect to the server to get object data.");
  }
}

/**
 * Main function for the detection workflow. Analyzes the captured image.
 */
async function analyzeCapturedImage() {
  if (!model || savedObjects.length === 0) {
    alert("Model or saved objects not ready yet.");
    return;
  }
  startDetectionBtn.textContent = "Analyzing...";
  startDetectionBtn.disabled = true;

  const capturedImage = document.getElementById("image-preview");
  const currentFeatures = await getFeatureVector(capturedImage);

  let matches = [];
  const MINIMUM_THRESHOLD = 0.5; // Only consider matches above 50% similarity

  for (const obj of savedObjects) {
    for (const savedFeature of obj.features) {
      const savedTensor = tf.tensor(savedFeature);
      const similarity = cosineSimilarity(currentFeatures, savedTensor);

      const existingMatch = matches.find((m) => m.id === obj.id);
      if (
        similarity > (existingMatch ? existingMatch.score : MINIMUM_THRESHOLD)
      ) {
        const matchData = {
          id: obj.id,
          name: obj.name,
          description: obj.description,
          score: similarity,
        };
        if (existingMatch) {
          existingMatch.score = similarity;
        } else {
          matches.push(matchData);
        }
      }
    }
  }

  matches.sort((a, b) => b.score - a.score); // Sort matches by highest score
  const finalMatches = matches.filter((match) => match.score >= 0.98);

  displayResults(finalMatches);

  startDetectionBtn.textContent = "Detect Object in Picture";
  startDetectionBtn.disabled = false;
}

/**
 * Renders the list of possible matches on the screen.
 */
function displayResults(matches) {
  const resultsList = document.getElementById("results-list");
  const resultsTitle = document.getElementById("results-title");
  resultsList.innerHTML = "";

  if (matches.length === 0) {
    resultsTitle.textContent = "No confident matches found.";
    return;
  }

  resultsTitle.textContent = `Found ${matches.length} possible match(es):`;

  matches.forEach((match) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${match.name}</span><strong>${Math.round(
      match.score * 100
    )}%</strong>`;
    li.addEventListener("click", () => {
      document.getElementById("popup-title").textContent = match.name;
      document.getElementById("popup-description").textContent =
        match.description;
      popupContainer.classList.remove("hidden");
    });
    resultsList.appendChild(li);
  });
}

// --- AI HELPER FUNCTIONS ---
/**
 * Takes an image element and returns its feature vector using MobileNet.
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
 * Calculates the cosine similarity between two tensors (how "similar" they are).
 */
function cosineSimilarity(tensorA, tensorB) {
  const dotProduct = tensorA.dot(tensorB).dataSync()[0];
  const normA = tensorA.norm().dataSync()[0];
  const normB = tensorB.norm().dataSync()[0];
  return dotProduct / (normA * normB);
}

// --- UTILITY FUNCTIONS ---
/**
 * Resets the 'Create New Object' form.
 */
function resetCreateForm() {
  document.getElementById("object-name").value = "";
  document.getElementById("object-description").value = "";
  imageUpload.value = "";
  document.getElementById("preview-container").innerHTML = "";
  createSection.classList.add("hidden");
  mainControls.classList.remove("hidden");
}
