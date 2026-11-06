import { OrthographicCamera, Raycaster, Vector2 } from 'three';

import { UIPanel } from './libs/ui.js';

import { ViewHelper as ViewHelperBase } from 'three/addons/helpers/ViewHelper.js';

class ViewHelper extends ViewHelperBase {

	constructor( editorCamera, container ) {

		super( editorCamera, container.dom );

		this.location.top = 30;

		const panel = new UIPanel();
		panel.setId( 'viewHelper' );
		panel.setPosition( 'absolute' );
		panel.setRight( '0px' );
		panel.setTop( '30px' );
		panel.setHeight( '128px' );
		panel.setWidth( '128px' );

		// The panel is transparent and sits over the viewport. Only presses on an axis button belong to
		// the helper; everything else must reach the canvas so transform gizmo and orbit drags work there.
		panel.dom.style.pointerEvents = 'none';

		const hitCamera = new OrthographicCamera( - 2, 2, 2, - 2, 0, 4 );
		hitCamera.position.set( 0, 0, 2 );
		hitCamera.updateMatrixWorld();
		const hitRaycaster = new Raycaster();
		const hitPointer = new Vector2();

		const hitsAxis = ( event ) => {

			if ( this.visible === false || this.animating === true || panel.dom.hidden ) return false;

			const rect = panel.dom.getBoundingClientRect();
			if ( rect.width === 0 || rect.height === 0 ) return false;
			if ( event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom ) return false;

			hitPointer.set( ( event.clientX - rect.left ) / rect.width * 2 - 1, - ( event.clientY - rect.top ) / rect.height * 2 + 1 );
			hitRaycaster.setFromCamera( hitPointer, hitCamera );
			return hitRaycaster.intersectObjects( this.children.filter( ( child ) => child.isSprite ) ).length > 0;

		};

		let pressed = false;

		const onPointerDown = ( event ) => {

			pressed = hitsAxis( event );
			if ( pressed === false ) return;
			event.stopPropagation();
			// Suppress the compatibility mouse events so the viewport does not also select under the helper.
			event.preventDefault();

		};

		const onPointerUp = ( event ) => {

			if ( pressed === false ) return;
			pressed = false;
			event.stopPropagation();
			this.handleClick( event );

		};

		// Capture on the container runs before the canvas listeners (TransformControls, EditorControls).
		container.dom.addEventListener( 'pointerdown', onPointerDown, true );
		container.dom.addEventListener( 'pointerup', onPointerUp, true );

		const disposeHelper = this.dispose;
		this.dispose = () => {

			container.dom.removeEventListener( 'pointerdown', onPointerDown, true );
			container.dom.removeEventListener( 'pointerup', onPointerUp, true );
			disposeHelper.call( this );

		};

		container.add( panel );

	}

}

export { ViewHelper };
