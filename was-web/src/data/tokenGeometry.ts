import { GridCoord, GridEdge, GridVertex } from "./coord";
import { IToken, TokenSize } from "./feature";
import { LoSPosition } from "./losPosition";
import { MapType } from "./map";

// Expresses what faces, fill edges and fill vertices make up large tokens in
// the given geometry.
export interface ITokenGeometry {
  enumerateFacePositions(token: IToken): Iterable<GridCoord>;
  enumerateFillEdgePositions(token: IToken): Iterable<GridEdge>;
  enumerateFillVertexPositions(token: IToken): Iterable<GridVertex>;
  getTextPosition(token: IToken): GridVertex;
  getTextAtVertex(token: IToken): boolean;
  getTokenSizes(): TokenSize[];
}

const hexTokenGeometry: ITokenGeometry = {
  *enumerateFacePositions(token: IToken) {
    // Always, the centre position:
    yield token.position;
    if (token.size === "1") {
      return;
    }

    if (token.size.indexOf('l') >= 0) {
      // The two left positions:
      yield { x: token.position.x - 1, y: token.position.y };
      yield { x: token.position.x - 1, y: token.position.y + 1 };
      if (token.size[0] === '2') {
        return;
      }

      // The rest of the 3
      yield { x: token.position.x, y: token.position.y + 1 };
      yield { x: token.position.x + 1, y: token.position.y };
      yield { x: token.position.x + 1, y: token.position.y - 1 };
      yield { x: token.position.x, y: token.position.y - 1 };
      if (token.size === '3') {
        return;
      }

      // The five further left positions:
      yield { x: token.position.x - 1, y: token.position.y - 1 };
      yield { x: token.position.x - 2, y: token.position.y };
      yield { x: token.position.x - 2, y: token.position.y + 1 };
      yield { x: token.position.x - 2, y: token.position.y + 2 };
      yield { x: token.position.x - 1, y: token.position.y + 2 };
    } else {
      // The two top-left positions:
      yield { x: token.position.x, y: token.position.y - 1 };
      yield { x: token.position.x - 1, y: token.position.y };
      if (token.size[0] === '2') {
        return;
      }

      // The rest of the 3
      yield { x: token.position.x - 1, y: token.position.y + 1 };
      yield { x: token.position.x, y: token.position.y + 1 };
      yield { x: token.position.x + 1, y: token.position.y };
      yield { x: token.position.x + 1, y: token.position.y - 1 };
      if (token.size === '3') {
        return;
      }

      // The five further top-left positions:
      yield { x: token.position.x + 1, y: token.position.y - 2 };
      yield { x: token.position.x, y: token.position.y - 2 };
      yield { x: token.position.x - 1, y: token.position.y - 1 };
      yield { x: token.position.x - 2, y: token.position.y };
      yield { x: token.position.x - 2, y: token.position.y + 1 };
    }
  },

  *enumerateFillEdgePositions(token: IToken): Iterable<GridEdge> {
    if (token.size === '1') {
      return;
    }

    if (token.size.indexOf('l') >= 0) {
      // The crosshair in the middle
      yield { x: token.position.x - 1, y: token.position.y + 1, edge: 1 };
      yield { x: token.position.x - 1, y: token.position.y + 1, edge: 2 };
      yield { x: token.position.x, y: token.position.y, edge: 0 };
      if (token.size[0] === '2') {
        return;
      }

      // The rest of the 3
      yield { x: token.position.x - 1, y: token.position.y, edge: 2 };
      yield { x: token.position.x, y: token.position.y, edge: 1 };
      yield { x: token.position.x + 1, y: token.position.y - 1, edge: 0 };
      yield { x: token.position.x, y: token.position.y, edge: 2 };
      yield { x: token.position.x + 1, y: token.position.y, edge: 1 };
      yield { x: token.position.x + 1, y: token.position.y, edge: 0 };
      yield { x: token.position.x, y: token.position.y + 1, edge: 2 };
      yield { x: token.position.x, y: token.position.y + 1, edge: 1 };
      yield { x: token.position.x, y: token.position.y + 1, edge: 0 };
      if (token.size[0] === '3') {
        return;
      }

      // The left positions:
      yield { x: token.position.x, y: token.position.y - 1, edge: 0 };
      yield { x: token.position.x - 1, y: token.position.y, edge: 1 };
      yield { x: token.position.x - 2, y: token.position.y, edge: 2 };
      yield { x: token.position.x - 1, y: token.position.y, edge: 0 };
      yield { x: token.position.x - 2, y: token.position.y + 1, edge: 1 };
      yield { x: token.position.x - 2, y: token.position.y + 1, edge: 2 };
      yield { x: token.position.x - 1, y: token.position.y + 1, edge: 0 };
      yield { x: token.position.x - 2, y: token.position.y + 2, edge: 1 };
      yield { x: token.position.x - 2, y: token.position.y + 2, edge: 2 };
      yield { x: token.position.x - 1, y: token.position.y + 2, edge: 0 };
      yield { x: token.position.x - 1, y: token.position.y + 2, edge: 1 };
      yield { x: token.position.x - 1, y: token.position.y + 2, edge: 2 };
    } else {
      // The crosshair in the middle
      yield { x: token.position.x, y: token.position.y, edge: 1 };
      yield { x: token.position.x - 1, y: token.position.y, edge: 2 };
      yield { x: token.position.x, y: token.position.y, edge: 0 };
      if (token.size[0] === '2') {
        return;
      }

      // The rest of the 3
      yield { x: token.position.x - 1, y: token.position.y + 1, edge: 1 };
      yield { x: token.position.x - 1, y: token.position.y + 1, edge: 2 };
      yield { x: token.position.x, y: token.position.y + 1, edge: 0 };
      yield { x: token.position.x, y: token.position.y + 1, edge: 1 };
      yield { x: token.position.x, y: token.position.y + 1, edge: 2 };
      yield { x: token.position.x + 1, y: token.position.y, edge: 0 };
      yield { x: token.position.x + 1, y: token.position.y, edge: 1 };
      yield { x: token.position.x, y: token.position.y, edge: 2 };
      yield { x: token.position.x + 1, y: token.position.y - 1, edge: 0 };
      if (token.size[0] === '3') {
        return;
      }

      // The top-left positions:
      yield { x: token.position.x + 1, y: token.position.y - 1, edge: 1 };
      yield { x: token.position.x, y: token.position.y - 1, edge: 2 };
      yield { x: token.position.x + 1, y: token.position.y - 2, edge: 0 };
      yield { x: token.position.x, y: token.position.y - 1, edge: 1 };
      yield { x: token.position.x - 1, y: token.position.y - 1, edge: 2 };
      yield { x: token.position.x, y: token.position.y - 1, edge: 0 };
      yield { x: token.position.x - 1, y: token.position.y, edge: 1 };
      yield { x: token.position.x - 2, y: token.position.y, edge: 2 };
      yield { x: token.position.x - 1, y: token.position.y, edge: 0 };
      yield { x: token.position.x - 2, y: token.position.y + 1, edge: 1 };
      yield { x: token.position.x - 2, y: token.position.y + 1, edge: 2 };
      yield { x: token.position.x - 1, y: token.position.y + 1, edge: 0 };
    }
  },

  *enumerateFillVertexPositions(token: IToken): Iterable<GridVertex> {
    if (token.size === '1') {
      return;
    }

    if (token.size.indexOf('l') >= 0) {
      // The crosshair in the middle
      yield { x: token.position.x, y: token.position.y, vertex: 0 };
      if (token.size[0] === '2') {
        return;
      }

      // The rest of the 3
      yield { x: token.position.x, y: token.position.y + 1, vertex: 1 };
      yield { x: token.position.x + 1, y: token.position.y, vertex: 0 };
      yield { x: token.position.x + 1, y: token.position.y, vertex: 1 };
      yield { x: token.position.x + 1, y: token.position.y - 1, vertex: 0 };
      yield { x: token.position.x, y: token.position.y, vertex: 1 };
      if (token.size[0] === '3') {
        return;
      }

      // The left positions:
      yield { x: token.position.x, y: token.position.y - 1, vertex: 0 };
      yield { x: token.position.x - 1, y: token.position.y, vertex: 1 };
      yield { x: token.position.x - 1, y: token.position.y, vertex: 0 };
      yield { x: token.position.x - 1, y: token.position.y + 1, vertex: 1 };
      yield { x: token.position.x - 1, y: token.position.y + 1, vertex: 0 };
      yield { x: token.position.x - 1, y: token.position.y + 2, vertex: 1 };
      yield { x: token.position.x, y: token.position.y + 1, vertex: 0 };
    } else {
      // The crosshair in the middle
      yield { x: token.position.x, y: token.position.y, vertex: 1 };
      if (token.size[0] === '2') {
        return;
      }

      // The rest of the 3
      yield { x: token.position.x, y: token.position.y + 1, vertex: 1 };
      yield { x: token.position.x + 1, y: token.position.y, vertex: 0 };
      yield { x: token.position.x + 1, y: token.position.y, vertex: 1 };
      yield { x: token.position.x + 1, y: token.position.y - 1, vertex: 0 };
      yield { x: token.position.x, y: token.position.y, vertex: 0 };
      if (token.size[0] === '3') {
        return;
      }

      // The top-left positions:
      yield { x: token.position.x + 1, y: token.position.y - 1, vertex: 1 };
      yield { x: token.position.x + 1, y: token.position.y - 2, vertex: 0 };
      yield { x: token.position.x, y: token.position.y - 1, vertex: 1 };
      yield { x: token.position.x, y: token.position.y - 1, vertex: 0 };
      yield { x: token.position.x - 1, y: token.position.y, vertex: 1 };
      yield { x: token.position.x - 1, y: token.position.y, vertex: 0 };
      yield { x: token.position.x - 1, y: token.position.y + 1, vertex: 1 };
    }
  },
  
  getTextPosition(token: IToken): GridVertex {
    if (token.outline) {
      switch (token.size[0]) {
        case '1': return { ...token.position, vertex: 0 };
        case '2':
          if (token.size.indexOf('l') >= 0) {
            return { x: token.position.x - 1, y: token.position.y + 1, vertex: 0 };
          } else {
            return { ...token.position, vertex: 0 };
          }

        case '3': return { x: token.position.x, y: token.position.y + 1, vertex: 0 };
        default: // 4
          if (token.size.indexOf('l') >= 0) {
            return { x: token.position.x - 1, y: token.position.y + 2, vertex: 0 };
          } else {
            return { x: token.position.x, y: token.position.y + 1, vertex: 0 };
          }
      }
    } else {
      return { ...token.position, vertex: token.size.indexOf('l') >= 0 ? 0 : 1 };
    }
  },

  getTextAtVertex(token: IToken): boolean {
    return !token.outline && (token.size[0] === '2' || token.size[0] === '4');
  },

  getTokenSizes(): TokenSize[] {
    return ["1", "2 (left)", "2 (right)", "3", "4 (left)", "4 (right)"];
  }
};

const squareTokenGeometry: ITokenGeometry = {
  *enumerateFacePositions(token: IToken) {
    // Always, the centre position:
    yield token.position;
    if (token.size === '1') {
      return;
    }

    // The three top-left positions:
    yield { x: token.position.x, y: token.position.y - 1 };
    yield { x: token.position.x - 1, y: token.position.y - 1 };
    yield { x: token.position.x - 1, y: token.position.y };
    if (token.size[0] === '2') {
      return;
    }

    // Complete the 3:
    yield { x: token.position.x - 1, y: token.position.y + 1 };
    yield { x: token.position.x, y: token.position.y + 1 };
    yield { x: token.position.x + 1, y: token.position.y };
    yield { x: token.position.x + 1, y: token.position.y - 1 };
    if (token.size === '3') {
      yield { x: token.position.x + 1, y: token.position.y + 1 };
      return;
    }

    // The four further top-left positions:
    yield { x: token.position.x, y: token.position.y - 2 };
    yield { x: token.position.x - 1, y: token.position.y - 2 };
    yield { x: token.position.x - 2, y: token.position.y - 1 };
    yield { x: token.position.x - 2, y: token.position.y };
  },

  *enumerateFillEdgePositions(token: IToken): Iterable<GridEdge> {
    if (token.size === '1') {
      return;
    }

    // The crosshair in the middle
    yield { x: token.position.x, y: token.position.y, edge: 0 };
    yield { x: token.position.x, y: token.position.y, edge: 1 };
    yield { x: token.position.x, y: token.position.y - 1, edge: 0 };
    yield { x: token.position.x - 1, y: token.position.y, edge: 1 };
    if (token.size[0] === '2') {
      return;
    }

    // Complete the 3:
    yield { x: token.position.x + 1, y: token.position.y - 1, edge: 0 };
    yield { x: token.position.x + 1, y: token.position.y, edge: 1 };
    yield { x: token.position.x + 1, y: token.position.y, edge: 0 };
    yield { x: token.position.x - 1, y: token.position.y + 1, edge: 1 };
    yield { x: token.position.x, y: token.position.y + 1, edge: 1 };
    yield { x: token.position.x, y: token.position.y + 1, edge: 0 };
    if (token.size === '3') {
      yield { x: token.position.x + 1, y: token.position.y + 1, edge: 0 };
      yield { x: token.position.x + 1, y: token.position.y + 1, edge: 1 };
      return;
    }

    // Complete the 4:
    yield { x: token.position.x, y: token.position.y - 2, edge: 0 };
    yield { x: token.position.x, y: token.position.y - 1, edge: 1 };
    yield { x: token.position.x - 1, y: token.position.y - 1, edge: 1 };
    yield { x: token.position.x - 2, y: token.position.y, edge: 1 };
    yield { x: token.position.x - 1, y: token.position.y, edge: 0 };
    yield { x: token.position.x - 1, y: token.position.y - 1, edge: 0 };
  },

  *enumerateFillVertexPositions(token: IToken): Iterable<GridVertex> {
    if (token.size === '1') {
      return;
    }

    // The centre of the middle crosshair
    yield { x: token.position.x, y: token.position.y, vertex: 0 };
    if (token.size[0] === '2') {
      return;
    }

    // The three other vertices around the middle square
    yield { x: token.position.x + 1, y: token.position.y, vertex: 0 };
    yield { x: token.position.x, y: token.position.y + 1, vertex: 0 };
    if (token.size[0] === '3') {
      yield { x: token.position.x + 1, y: token.position.y + 1, vertex: 0 };
      return;
    }

    // The pair of top-left vertices
    yield { x: token.position.x - 1, y: token.position.y, vertex: 0 };
    yield { x: token.position.x, y: token.position.y - 1, vertex: 0 };
  },
  
  getTextPosition(token: IToken): GridVertex {
    if (token.outline) {
      switch (token.size) {
        case '1': case '2': return { ...token.position, vertex: 0 };
        default: return { x: token.position.x, y: token.position.y + 1, vertex: 0 };
      }
    } else {
      return { ...token.position, vertex: 0 };
    }
  },

  getTextAtVertex(token: IToken): boolean {
    return !token.outline && (token.size[0] === '2' || token.size[0] === '4');
  },

  getTokenSizes(): TokenSize[] {
    return ["1", "2", "3", "4"];
  }
};

export function getTokenGeometry(ty: MapType): ITokenGeometry {
  return ty === MapType.Hex ? hexTokenGeometry : squareTokenGeometry;
}

// Calculate the grid position and radius for a token's LoS position.
// Returns grid coordinates (x, y) plus a radius for shadow calculations.
// The world coordinate conversion happens at render time in los.ts.
export function getTokenLoSPosition(
  token: IToken,
  tokenGeometry: ITokenGeometry,
  faceSize: number
): LoSPosition {
  // Get all face positions for this token
  const faces = Array.from(tokenGeometry.enumerateFacePositions(token));

  let x: number, y: number, radius: number;

  if (faces.length === 1) {
    // Size 1 token: use the token position directly
    x = token.position.x;
    y = token.position.y;
    radius = faceSize / 2;
  } else {
    // Multi-tile token: calculate average of all face positions
    x = faces.reduce((sum, f) => sum + f.x, 0) / faces.length;
    y = faces.reduce((sum, f) => sum + f.y, 0) / faces.length;

    // Calculate radius based on token size
    switch (token.size[0]) {
      case '2':
        // Size 2: covers 3 (hex) or 4 (square) tiles
        radius = faceSize;
        break;
      case '3':
        // Size 3: covers 7 (hex) or 9 (square) tiles
        radius = faceSize * 1.5;
        break;
      case '4':
        // Size 4: covers 12 tiles
        radius = faceSize * 2;
        break;
      default:
        radius = faceSize / 2;
    }
  }

  return { x, y, radius };
}
