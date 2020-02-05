/**
 * External dependencies
 */
import {
	filter,
	get,
} from 'lodash';
import { match } from 'css-mediaquery';

/**
 * WordPress dependencies
 */
import { useEffect } from '@wordpress/element';

const ENABLED_MEDIA_QUERY = '(min-width:0px)';
const DISABLED_MEDIA_QUERY = '(min-width:999999px)';

const VALID_MEDIA_QUERY_REGEX = /\((min|max)-width:[^\(]*?\)/g;

function getStyleSheetsThatMatchHostname() {
	return filter(
		get( window, [ 'document', 'styleSheets' ], [] ),
		( styleSheet ) => {
			return (
				styleSheet.href && styleSheet.href.includes( window.location.hostname )
			);
		}
	);
}

function isReplaceableMediaRule( rule ) {
	if ( ! rule.media ) {
		return false;
	}
	// Need to use "media.mediaText" instead of "conditionText" for IE support.
	return !! rule.media.mediaText.match( VALID_MEDIA_QUERY_REGEX );
}

function replaceRule( styleSheet, newRuleText, index ) {
	styleSheet.deleteRule( index );
	styleSheet.insertRule( newRuleText, index );
}

function replaceMediaQueryWithWidthEvaluation( ruleText, widthValue ) {
	return ruleText.replace( VALID_MEDIA_QUERY_REGEX, ( matchedSubstring ) => {
		if (
			match(
				matchedSubstring,
				{
					type: 'screen',
					width: widthValue,
				}
			)
		) {
			return ENABLED_MEDIA_QUERY;
		}
		return DISABLED_MEDIA_QUERY;
	} );
}

/**
 * Function that manipulates media queries from stylesheets to simulate a given viewport width.
 *
 * @param {Array} partialPaths Paths of stylesheets to manipulate.
 * @param {number} width Viewport width to simulate.
 */
export default function useSimulatedMediaQuery( width ) {
	useEffect(
		() => {
			const styleSheets = getStyleSheetsThatMatchHostname( );
			const originalStyles = [];
			styleSheets.forEach( ( styleSheet, styleSheetIndex ) => {
				let relevantSection = false;
				for ( let ruleIndex = 0; ruleIndex < styleSheet.cssRules.length; ++ruleIndex ) {
					const rule = styleSheet.cssRules[ ruleIndex ];

					if ( ! relevantSection && !! rule.cssText.match( /#start-resizable-editor-section/ ) ) {
						relevantSection = true;
					}

					if ( relevantSection && !! rule.cssText.match( /#end-resizable-editor-section/ ) ) {
						relevantSection = false;
					}

					if ( ! relevantSection || ! isReplaceableMediaRule( rule ) ) {
						continue;
					}
					const ruleText = rule.cssText;
					if ( ! originalStyles[ styleSheetIndex ] ) {
						originalStyles[ styleSheetIndex ] = [];
					}
					originalStyles[ styleSheetIndex ][ ruleIndex ] = ruleText;
					replaceRule(
						styleSheet,
						replaceMediaQueryWithWidthEvaluation( ruleText, width ),
						ruleIndex
					);
				}
			} );
			return () => {
				originalStyles.forEach( ( rulesCollection, styleSheetIndex ) => {
					if ( ! rulesCollection ) {
						return;
					}
					for ( let ruleIndex = 0; ruleIndex < rulesCollection.length; ++ruleIndex ) {
						const originalRuleText = rulesCollection[ ruleIndex ];
						if ( originalRuleText ) {
							replaceRule( styleSheets[ styleSheetIndex ], originalRuleText, ruleIndex );
						}
					}
				} );
			};
		},
		[ width ]
	);
}

