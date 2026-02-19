# Brain Organoid Analysis

A minimalist, data-driven web application for visualizing brain organoid neuron locations and spike activity. Inspired by the aesthetic sensibilities of Ryoji Ikeda and Refik Anadol.

## Features

- **Dual CSV Upload**: Upload neuron location and spike activity data
- **Organoid Map**: Interactive D3.js visualization showing neuron positions with backbone differentiation
- **Spike Activity Analysis**: 
  - Network activity timeline
  - Firing rate distribution
  - Spike raster plot
- **Minimalist Design**: Monochromatic palette, geometric typography, data-first presentation

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
npm run build
```

## Data Format

### Neuron Location CSV

```csv
neuron_id,x,y,is_backbone
1,0.5,0.3,true
2,0.7,0.8,false
```

- `neuron_id`: Unique identifier for the neuron
- `x`: X position (0-1 range recommended)
- `y`: Y position (0-1 range recommended)
- `is_backbone`: Boolean indicating if neuron is a backbone neuron

### Spike Activity CSV

```csv
timestamp_ms,neuron_id
1.5,3
2.3,10
```

- `timestamp_ms`: Time of spike in milliseconds
- `neuron_id`: ID of neuron that fired

Sample rate: 20kHz

## Sample Data

Sample CSV files are provided in the `sample_data/` directory:
- `neurons.csv` - 30 neurons with backbone markers
- `spikes.csv` - 100 spike events

## Tech Stack

- **Frontend**: React + TypeScript
- **Build Tool**: Vite
- **Visualization**: D3.js, Recharts
- **CSV Parsing**: PapaParse
- **Typography**: Outfit (geometric sans-serif)

## Design Philosophy

The application embodies:
- **Ryoji Ikeda**: Minimal interface, monochromatic palette, data as art, precision
- **Refik Anadol**: Fluid data visualization, particle aesthetics, dynamic interactions

## License

MIT
