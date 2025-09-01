# 🐱 Random Cat Photos App

A delightful web application that serves random cat photos with a modern, responsive interface. Built on Cloudflare's edge network for lightning-fast global performance.

## ✨ Features

- **Random Cat Photos**: Endless stream of adorable cat images
- **Responsive Design**: Mobile-first design that works on all devices
- **Fast Performance**: Served from Cloudflare's global edge network
- **Simple Interface**: Clean, intuitive UI with one-click random photo generation
- **Social Media Ready**: Open Graph and Twitter Card support for sharing
- **Progressive Web App**: Works offline and can be installed on devices

## 🚀 Live Demo

Visit [turkkedy.net](https://turkkedy.net) to see the app in action!

## 🏗️ Architecture

This app is built using Cloudflare's modern web platform:

- **Frontend**: Static HTML/CSS/JavaScript served from Cloudflare Pages
- **Backend**: Cloudflare Workers (Edge Functions) for API endpoints
- **Storage**: Cloudflare R2 for image storage and CDN
- **Deployment**: Automatic deployment via Cloudflare Pages

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript, CSS3, HTML5
- **Backend**: Cloudflare Workers (TypeScript)
- **Storage**: Cloudflare R2 Object Storage
- **CDN**: Cloudflare's global edge network
- **Deployment**: Cloudflare Pages

## 📁 Project Structure

```
turkkedy.net/
├── public/                 # Static assets for Cloudflare Pages
│   └── index.html         # Main application
├── functions/             # Cloudflare Workers (Edge Functions)
│   └── api/
│       ├── manifest.ts    # Serves the image manifest
│       └── admin/         # Admin endpoints
├── cats/                  # Source cat images
├── wrangler.toml          # Cloudflare configuration
├── package.json           # Dependencies
└── upload_cats.py         # Image upload script
```

## 🚀 Getting Started

### Prerequisites

1. **Cloudflare Account**: Sign up at [cloudflare.com](https://cloudflare.com)
2. **Wrangler CLI**: Install the Cloudflare CLI tool
3. **Node.js**: Version 18 or higher

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd turkkedy.net
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Wrangler CLI**
   ```bash
   npm install -g wrangler
   ```

4. **Authenticate with Cloudflare**
   ```bash
   wrangler auth login
   ```

### Configuration

1. **Update `wrangler.toml`**
   ```toml
   name = "your-app-name"
   compatibility_date = "2024-10-01"
   
   [[r2_buckets]]
   binding = "cats"
   bucket_name = "your-bucket-name"
   
   [vars]
   CDN_BASE = "https://your-cdn-domain.com"
   SITE_BASE = "https://your-domain.com"
   ```

2. **Create R2 bucket**
   - Go to Cloudflare Dashboard → R2 Object Storage
   - Create a new bucket named `cats` (or your preferred name)
   - Configure public access if desired

### Upload Cat Images

1. **Place cat images in the `cats/` directory**
   - Supported formats: JPG, PNG, GIF, WebP, AVIF, BMP, TIFF
   - Images will be automatically optimized and watermarked

2. **Run the upload script**
   ```bash
   # Dry run to preview
   python3 upload_cats.py --dry-run
   
   # Upload with progress
   python3 upload_cats.py --progress
   ```

3. **Generate manifest**
   ```bash
   python3 generate_manifest.py
   ```

### Deploy

1. **Deploy to Cloudflare Pages**
   ```bash
   wrangler pages deploy public
   ```

2. **Or connect your GitHub repository**
   - Push your code to GitHub
   - Connect the repository in Cloudflare Pages dashboard
   - Enable automatic deployments

## 🔧 Development

### Local Development

1. **Start local development server**
   ```bash
   wrangler pages dev public
   ```

2. **Test Edge Functions locally**
   ```bash
   wrangler dev
   ```

### Adding New Features

- **Frontend**: Edit files in `public/` directory
- **API**: Add new endpoints in `functions/api/`
- **Styling**: Modify CSS in `public/index.html`

## 📱 API Endpoints

### `/api/manifest`
- **GET**: Returns the list of available cat images
- **Response**: JSON array of image metadata
- **Cache**: 5 minutes at edge

### `/api/admin/rebuild-manifest`
- **GET**: Rebuilds the image manifest (admin only)
- **Query**: `?key=<admin-key>`

## 🎨 Customization

### Styling
The app uses CSS custom properties for easy theming:
```css
:root {
  --bg: #0f1115;      /* Background color */
  --fg: #e6e6e6;      /* Foreground/text color */
  --muted: #9aa0a6;   /* Muted/secondary color */
  --btn: #1f232b;     /* Button background */
  --btnh: #2a2f3a;    /* Button hover */
}
```

### Images
- **Source**: Place images in `cats/` directory
- **Optimization**: Images are automatically optimized with watermarks
- **Formats**: Supports all major image formats
- **Naming**: Use sequential numbers (00001.webp, 00002.webp, etc.)

## 🚀 Performance

- **Edge Caching**: Images cached at Cloudflare's global edge
- **Optimized Images**: WebP format with optimal compression
- **Lazy Loading**: Images loaded on-demand
- **CDN**: Global distribution for fast loading worldwide

## 🔒 Security

- **Admin Protection**: Manifest rebuild requires admin key
- **CORS**: Proper CORS headers for API endpoints
- **Input Validation**: All inputs are validated and sanitized
- **HTTPS Only**: Served over secure HTTPS connections

## 📊 Monitoring

- **Cloudflare Analytics**: Built-in performance monitoring
- **Error Tracking**: Automatic error logging and reporting
- **Performance Metrics**: Core Web Vitals tracking

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- **Cloudflare**: For the amazing edge computing platform
- **Cat Owners**: For sharing their adorable feline friends
- **Open Source Community**: For the tools and libraries that make this possible

---

Made with ❤️ and lots of 🐱 by [Berk Logun](https://github.com/BerkLogun)

*Enjoy the endless stream of cat photos!* 🎉
