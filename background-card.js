import { LitElement, html, css } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";

class BackgroundCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      currentImageIndex: { type: Number },
      imageList: { type: Array },
      imageA: { type: String },
      imageB: { type: String },
      activeImage: { type: String },
      preloadedImage: { type: String },
      screenWidth: { type: Number },
      screenHeight: { type: Number },
      error: { type: String },
      debugInfo: { type: Object },
      isTransitioning: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.currentImageIndex = -1;
    this.imageList = [];
    this.imageA = "";
    this.imageB = "";
    this.activeImage = "A";
    this.preloadedImage = "";
    this.imageUpdateInterval = null;
    this.imageListUpdateInterval = null;
    this.error = null;
    this.debugInfo = {};
    this.urlTemplate = "";
    this.boundUpdateScreenSize = this.updateScreenSize.bind(this);
    this.isTransitioning = false;
    this.updateScreenSize();
  }

  setConfig(config) {
    if (!config.image_url) {
      throw new Error("You need to define an image_url");
    }
    this.config = {
      image_url: "",
      display_time: 15,
      crossfade_time: 3,
      image_fit: "cover",
      image_list_update_interval: 3600,
      image_order: "sorted",
      ...config,
    };
    this.urlTemplate = this.config.image_url;
    this.debugInfo.config = this.config;
    console.log("Config set:", this.config);
  }

  connectedCallback() {
    super.connectedCallback();
    console.log("Card connected");
    window.addEventListener('resize', this.boundUpdateScreenSize);
    this.updateImageList();
    this.startImageRotation();
    this.imageListUpdateInterval = setInterval(() => {
      this.updateImageList();
    }, this.config.image_list_update_interval * 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    console.log("Card disconnected");
    window.removeEventListener('resize', this.boundUpdateScreenSize);
    clearInterval(this.imageUpdateInterval);
    clearInterval(this.imageListUpdateInterval);
  }

  updateScreenSize() {
    const pixelRatio = window.devicePixelRatio || 1;
    this.screenWidth = Math.round(screen.width * pixelRatio);
    this.screenHeight = Math.round(screen.height * pixelRatio);
    console.log(`Actual screen resolution: ${this.screenWidth}x${this.screenHeight}`);
    this.updateImageList();
  }

  getImageUrl() {
    const timestamp_ms = Date.now();
    const timestamp = Math.floor(timestamp_ms / 1000);
    let url = this.urlTemplate;
    url = url.replace(/\${width}/g, this.screenWidth);
    url = url.replace(/\${height}/g, this.screenHeight);
    url = url.replace(/\${timestamp_ms}/g, timestamp_ms);
    url = url.replace(/\${timestamp}/g, timestamp);
    console.log("Generated image URL:", url);
    return url;
  }

  async updateImageList() {
    console.log("Updating image list");
    if (!this.screenWidth || !this.screenHeight) {
      console.error("Screen dimensions not set");
      this.error = "Screen dimensions not set";
      this.requestUpdate();
      return;
    }
    const imageSourceType = this.getImageSourceType();
    let newImageList = [];

    try {
      switch (imageSourceType) {
        case "media-source":
          newImageList = await this.getImagesFromMediaSource();
          break;
        case "unsplash-api":
          newImageList = await this.getImagesFromUnsplashAPI();
          break;
        case "immich-api":
          newImageList = await this.getImagesFromImmichAPI();
          break;
        case "picsum":
          newImageList = [this.getImageUrl()];
          break;
        default:
          newImageList = [this.getImageUrl()];
      }

      if (this.config.image_order === "random") {
        newImageList.sort(() => 0.5 - Math.random());
      } else {
        newImageList.sort();
      }

      this.imageList = newImageList;
      this.error = null;
      this.debugInfo.imageList = this.imageList;
      console.log("Updated image list:", this.imageList);
    } catch (error) {
      console.error("Error updating image list:", error);
      this.error = `Error updating image list: ${error.message}`;
    }
    this.requestUpdate();
  }

  getImageSourceType() {
    const { image_url } = this.config;
    if (image_url.startsWith("media-source://")) return "media-source";
    if (image_url.startsWith("https://api.unsplash")) return "unsplash-api";
    if (image_url.startsWith("immich+")) return "immich-api";
    if (image_url.includes("picsum.photos")) return "picsum";
    return "url";
  }

  async getImagesFromMediaSource() {
    try {
      const mediaContentId = this.config.image_url.replace(/^media-source:\/\//, '');
      const result = await this.hass.callWS({
        type: "media_source/browse_media",
        media_content_id: mediaContentId
      });

      return result.children
        .filter(child => child.media_class === "image")
        .map(child => child.media_content_id);
    } catch (error) {
      console.error("Error fetching images from media source:", error);
      return [this.getImageUrl()];
    }
  }

  async getImagesFromUnsplashAPI() {
    try {
      const response = await fetch(`${this.config.image_url}&count=30`);
      const data = await response.json();
      return data.map(image => image.urls.regular);
    } catch (error) {
      console.error("Error fetching images from Unsplash API:", error);
      return [this.getImageUrl()];
    }
  }

  async getImagesFromImmichAPI() {
    try {
      const apiUrl = this.config.image_url.replace(/^immich\+/, "");
      const response = await fetch(`${apiUrl}/albums`, {
        headers: {
          'x-api-key': this.config.immich_api_key
        }
      });
      const albums = await response.json();
      
      const imagePromises = albums.map(async (album) => {
        const albumResponse = await fetch(`${apiUrl}/albums/${album.id}`, {
          headers: {
            'x-api-key': this.config.immich_api_key
          }
        });
        const albumData = await albumResponse.json();
        return albumData.assets
          .filter(asset => asset.type === "IMAGE")
          .map(asset => `${apiUrl}/assets/${asset.id}/original`);
      });

      const imageArrays = await Promise.all(imagePromises);
      return imageArrays.flat();
    } catch (error) {
      console.error("Error fetching images from Immich API:", error);
      return [this.getImageUrl()];
    }
  }

  startImageRotation() {
    console.log("Starting image rotation");
    this.updateImage();
    this.imageUpdateInterval = setInterval(() => {
      this.updateImage();
    }, this.config.display_time * 1000);
  }

  async preloadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  async updateImage() {
    console.log("Updating image");
    if (this.isTransitioning) {
      console.log("Transition in progress, skipping update");
      return;
    }

    let newImage;
    if (this.getImageSourceType() === "picsum") {
      newImage = this.getImageUrl();
    } else {
      this.currentImageIndex = (this.currentImageIndex + 1) % this.imageList.length;
      newImage = this.imageList[this.currentImageIndex];
    }

    // If we have a preloaded image, use it
    if (this.preloadedImage) {
      newImage = this.preloadedImage;
      this.preloadedImage = "";
    } else {
      // If no preloaded image, load the new image now
      try {
        newImage = await this.preloadImage(newImage);
      } catch (error) {
        console.error("Error loading new image:", error);
        return; // Skip this update if we can't load the new image
      }
    }

    // Start preloading the next image for the following transition
    this.preloadNextImage();

    this.isTransitioning = true;

    if (this.activeImage === "A") {
      this.imageB = newImage;
    } else {
      this.imageA = newImage;
    }

    this.debugInfo.imageA = this.imageA;
    this.debugInfo.imageB = this.imageB;
    this.debugInfo.activeImage = this.activeImage;
    this.debugInfo.preloadedImage = this.preloadedImage;
    console.log("Image A:", this.imageA);
    console.log("Image B:", this.imageB);
    console.log("Active Image:", this.activeImage);
    console.log("Preloaded image:", this.preloadedImage);

    this.requestUpdate();

    // Start the transition
    setTimeout(() => {
      this.activeImage = this.activeImage === "A" ? "B" : "A";
      this.requestUpdate();

      // Reset transition state after the crossfade time
      setTimeout(() => {
        this.isTransitioning = false;
        this.requestUpdate();
      }, this.config.crossfade_time * 1000);
    }, 50); // Small delay to ensure DOM is updated
  }

  async preloadNextImage() {
    let nextImageToPreload;
    if (this.getImageSourceType() === "picsum") {
      nextImageToPreload = this.getImageUrl();
    } else {
      const nextIndex = (this.currentImageIndex + 1) % this.imageList.length;
      nextImageToPreload = this.imageList[nextIndex];
    }

    try {
      this.preloadedImage = await this.preloadImage(nextImageToPreload);
    } catch (error) {
      console.error("Error preloading next image:", error);
      this.preloadedImage = "";
    }
  }

  static get styles() {
    return css`
      :host {
        display: block;
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 1;
      }
      .background-image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-size: var(--image-fit);
        background-position: center;
        background-repeat: no-repeat;
        transition: opacity var(--crossfade-time) ease-in-out;
      }
      .error {
        color: red;
        padding: 16px;
      }
      .debug-info {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 16px;
        font-size: 14px;
        z-index: 10;
        max-width: 80%;
        max-height: 80%;
        overflow: auto;
        border-radius: 8px;
      }
    `;
  }

  updated(changedProperties) {
    if (changedProperties.has('config')) {
      this.style.setProperty('--image-fit', this.config.image_fit);
      this.style.setProperty('--crossfade-time', `${this.config.crossfade_time}s`);
    }
  }

  render() {
    const imageAOpacity = this.activeImage === "A" ? 1 : 0;
    const imageBOpacity = this.activeImage === "B" ? 1 : 0;

    return html`
      <div class="background-image" style="background-image: url('${this.imageA}'); opacity: ${imageAOpacity};"></div>
      <div class="background-image" style="background-image: url('${this.imageB}'); opacity: ${imageBOpacity};"></div>
      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      <div class="debug-info">
        <h2>Background Card Debug Info</h2>
        <h3>Background Card Version: 15</h3>
        <p><strong>Screen Width:</strong> ${this.screenWidth}</p>
        <p><strong>Screen Height:</strong> ${this.screenHeight}</p>
        <p><strong>Device Pixel Ratio:</strong> ${window.devicePixelRatio || 1}</p>
        <p><strong>Image A:</strong> ${this.imageA}</p>
        <p><strong>Image B:</strong> ${this.imageB}</p>
        <p><strong>Active Image:</strong> ${this.activeImage}</p>
        <p><strong>Preloaded Image:</strong> ${this.preloadedImage}</p>
        <p><strong>Is Transitioning:</strong> ${this.isTransitioning}</p>
        <p><strong>Image List:</strong> ${JSON.stringify(this.imageList)}</p>
        <p><strong>Error:</strong> ${this.error}</p>
        <h3>Config:</h3>
        <pre>${JSON.stringify(this.config, null, 2)}</pre>
      </div>
    `;
  }
}

customElements.define("background-card", BackgroundCard);
