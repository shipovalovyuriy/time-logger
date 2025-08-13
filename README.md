# Time Logger React App

A React application for tracking hours per project with an interactive circular interface.

## Features

- **Interactive Circular Interface**: Drag to adjust hours for each project
- **Project Management**: Track hours across multiple projects
- **Visual Feedback**: Color-coded project segments in the circle
- **Responsive Design**: Works on both desktop and mobile devices
- **Telegram WebApp Integration**: Can be embedded in Telegram bots

## Getting Started

### Prerequisites

- Node.js (version 16 or higher)
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Development

Start the development server:
```bash
npm start
```

The app will open in your browser at `http://localhost:3000`.

### Building for Production

Create a production build:
```bash
npm run build
```

The build files will be created in the `build` folder.

## Usage

1. **Select a Project**: Click on any project row to make it active
2. **Adjust Hours**: Drag on the circular interface to increase/decrease hours
3. **Submit**: Click the center button to submit the time data

## Project Structure

```
src/
├── components/
│   ├── TimeLogger.js      # Main component with all functionality
│   └── TimeLogger.css     # Component-specific styles
├── App.js                 # Main app component
├── App.css                # App-level styles
└── index.js               # Entry point
```

## Technologies Used

- React 18
- HTML5 Canvas for circular interface
- CSS3 for styling
- Telegram WebApp API integration

## License

This project is open source and available under the MIT License.
